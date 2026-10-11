// VO analysis helpers: CANON table + transcript diff + brand closure.
import { wordKey } from '../../js/data-core.js';
// Shared by qa, rank, and timing commands.

// Base canonicalization table: generic spoken-form → canonical token.
// Both sides of a diff (script text + STT transcript) pass through this table,
// so a pattern matching either the written form or the spoken form works.
const BASE_CANON = [
  // tech terms
  [/wi-?\s?fi/gi, 'wifi'],
];

/**
 * Build the project's canonicalization table.
 *
 * theme.json "spoken" field: { "<regex-pattern>": "<canonical-token>", … }
 * Keys are regex strings (case-insensitive); values are replacement tokens.
 * Project entries are PREPENDED to the base table (project rules take precedence).
 *
 * Use this for:
 *   - brand names that the STT mis-transcribes:
 *       "sail\\s*tra(x|cks)": "sailtrax"
 *   - prices/numbers spoken differently than written:
 *       "nineteen ninety|€\\s?19[.,]90": "EUR1990"
 *   - any spoken-form vs written-form ambiguity.
 */
export function buildCanon(theme = {}) {
  const overrides = Object.entries(theme.spoken ?? {})
    .map(([pat, rep]) => [new RegExp(pat, 'gi'), String(rep)]);
  return [...overrides, ...BASE_CANON];
}

const applyCanon = (s, canon) => canon.reduce((a, [re, v]) => a.replace(re, v), s);
/** lowercase; drop punctuation except apostrophes */
const clean = (w) => w.toLowerCase().replace(/['']/g, "'").replace(/[^a-z0-9']/g, '');

/**
 * Diff a verbose-JSON STT transcript against the TTS script text.
 *
 * @param {object} stt          - STT result: { words: [{word,start,end,confidence|probability}] }
 * @param {string} ttsText      - Script text for TTS (may contain [tags], inline tags are stripped)
 * @param {Array}  canon        - [[RegExp, replacement], …] from buildCanon()
 * @returns {{ ops, longMid, tight, lowConf, joins, first, last, rate, nRef, nHyp, words }}
 *   ops:     edit-distance operations (MISSING/EXTRA/SUB strings)
 *   longMid: pauses > 250 ms with no script punctuation at that join
 *   tight:   word joins < 40 ms
 *   lowConf: words with confidence < 0.6
 *   words:   aligned hyp words [{word, n, start, end, conf}]
 */
export function analyseTranscript(stt, ttsText, canon) {
  // reference: strip [tags] from ttsText, apply canon, build word list
  const ref = applyCanon(ttsText.replace(/\[[^\]]*\]/g, ''), canon)
    .split(/\s+/).filter(Boolean)
    .map((w) => ({ n: clean(applyCanon(w, canon)), punct: /[.,!?:;…]+$/.test(w) || /\.\.\.$/.test(w) }))
    .filter((w) => w.n);

  // hypothesis: merge multi-word STT tokens that canonicalise together
  const raw = stt.words.map((w) => ({
    word: String(w.word ?? '').trim(),
    start: w.start,
    end: w.end,
    conf: w.confidence ?? w.probability ?? null,
  }));
  const hyp = [];
  for (let i = 0; i < raw.length; i++) {
    let merged = null;
    for (const k of [4, 3, 2]) {
      if (i + k > raw.length) continue;
      const txt = raw.slice(i, i + k).map((x) => x.word).join(' ');
      const c = applyCanon(txt, canon);
      if (c !== txt && !c.includes(' ')) {
        merged = { word: txt, n: clean(c), start: raw[i].start, end: raw[i + k - 1].end, conf: raw[i].conf };
        i += k - 1;
        break;
      }
    }
    if (merged) {
      hyp.push(merged);
    } else {
      for (const part of applyCanon(raw[i].word, canon).split(/\s+/)) {
        if (clean(part)) hyp.push({ ...raw[i], n: clean(part) });
      }
    }
  }

  // compounds: STT often writes a brand as one word ("PromoClip") or splits one ("Demo Product")
  joinCompounds(ref, hyp);

  // Levenshtein alignment
  const n = ref.length, m = hyp.length;
  const D = Array.from({ length: n + 1 }, (_, i) =>
    Array.from({ length: m + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= n; i++)
    for (let j = 1; j <= m; j++)
      D[i][j] = Math.min(
        D[i - 1][j] + 1,
        D[i][j - 1] + 1,
        D[i - 1][j - 1] + (ref[i - 1].n === hyp[j - 1].n ? 0 : 1));

  const ops = [], align = new Array(m).fill(-1);
  for (let i = n, j = m; i > 0 || j > 0;) {
    if (i > 0 && j > 0 && D[i][j] === D[i - 1][j - 1] + (ref[i - 1].n === hyp[j - 1].n ? 0 : 1)) {
      if (ref[i - 1].n !== hyp[j - 1].n)
        ops.push(`SUB "${ref[i - 1].n}" → "${hyp[j - 1].word}" @${hyp[j - 1].start.toFixed(2)}s`);
      align[j - 1] = i - 1; i--; j--;
    } else if (i > 0 && D[i][j] === D[i - 1][j] + 1) {
      ops.push(`MISSING "${ref[i - 1].n}"`); i--;
    } else {
      ops.push(`EXTRA "${hyp[j - 1].word}" @${hyp[j - 1].start.toFixed(2)}s`); j--;
    }
  }
  ops.reverse();

  const joins = [];
  for (let j = 1; j < m; j++) {
    const a = hyp[j - 1], b = hyp[j];
    const scriptPunct = align[j - 1] >= 0 ? ref[align[j - 1]].punct : /[.,!?:;]$/.test(a.word);
    joins.push({ a: a.word, b: b.word, at: a.end, gap: b.start - a.end, scriptPunct });
  }
  const longMid = joins.filter((x) => !x.scriptPunct && x.gap > 0.25);
  const tight = joins.filter((x, k) => x.gap < 0.04 && !hyp[k + 1].compound);
  const lowConf = hyp.filter((w) => w.conf != null && w.conf < 0.6);
  const span = hyp.at(-1).end - hyp[0].start;
  return { ops, longMid, tight, lowConf, joins, first: hyp[0].start, last: hyp.at(-1).end, rate: m / span, nRef: n, nHyp: m, words: hyp };
}

/**
 * In place: split a hypothesis token that equals 2-3 consecutive script words joined
 * ("promoclip" vs "promo clip"; times shared by letter count), and merge 2-3 consecutive
 * hypothesis tokens that join to one script word ("demo product" vs "demoproduct").
 */
export function joinCompounds(ref, hyp) {
  const refSet = new Set(ref.map((r) => r.n));
  const grams = new Map();
  for (let i = 0; i < ref.length; i++) for (const k of [2, 3]) {
    if (i + k > ref.length) continue;
    const parts = ref.slice(i, i + k).map((r) => r.n);
    grams.set(parts.join(''), parts);
  }
  for (let j = 0; j < hyp.length; j++) {
    const h = hyp[j];
    // merge first (one script word spoken/transcribed as several)
    let merged = false;
    for (const k of [3, 2]) {
      if (j + k > hyp.length) continue;
      const joined = hyp.slice(j, j + k).map((x) => x.n).join('');
      if (refSet.has(joined) && !refSet.has(h.n)) {
        const last = hyp[j + k - 1];
        hyp.splice(j, k, { ...h, word: hyp.slice(j, j + k).map((x) => x.word).join(' '), n: joined, end: last.end });
        merged = true;
        break;
      }
    }
    if (merged || refSet.has(h.n)) continue;
    const parts = grams.get(h.n);
    if (!parts) continue;
    const total = parts.reduce((a, p) => a + p.length, 0);
    let t = h.start;
    const split = parts.map((p, i) => {
      const d = ((h.end - h.start) * p.length) / total;
      const punct = i === parts.length - 1 ? (h.word.match(/[.,!?:;…]+$/)?.[0] ?? '') : '';
      const w = { ...h, word: p + punct, n: p, start: +t.toFixed(3), end: +(t + d).toFixed(3), compound: i > 0 };
      t += d;
      return w;
    });
    hyp.splice(j, 1, ...split);
    j += split.length - 1;
  }
}

/**
 * Sentence spans from a timing words array.
 * Each word has { i, w, start, end }; sentences split on trailing punctuation.
 */
export function buildSentences(words) {
  const sentences = [];
  let cur = null;
  for (const w of words) {
    if (!cur) cur = { text: '', start: w.start, first: w.i };
    cur.text += (cur.text ? ' ' : '') + w.w;
    if (/[.!?]$|\.\.\.$/.test(w.w)) {
      sentences.push({ ...cur, end: w.end, last: w.i });
      cur = null;
    }
  }
  if (cur && words.length) sentences.push({ ...cur, end: words.at(-1).end, last: words.at(-1).i });
  return sentences;
}

/**
 * Capitalise the first letter of a timing word that matches a brand word token.
 * Only exact token matches (punctuation stripped) are affected.
 * For compound brand names (e.g. "SailTrax"), use a theme.json "spoken" override instead.
 */
export function brandNormalize(word, brandWords) {
  const bare = wordKey(word);
  for (const bw of brandWords) {
    if (bare === wordKey(bw)) return word.charAt(0).toUpperCase() + word.slice(1);
  }
  return word;
}

/**
 * Brand-word "closure" metric: ms of low-energy run in the word's middle 20–75%.
 * A high closure (> ~50 ms) on a word like "SailTrax" suggests the TTS paused
 * between the two parts — a quality defect worth penalising in ranking.
 *
 * @param {number[]} env  - RMS envelope in dBFS (10 ms hops)
 * @param {{ start, end }} word
 * @param {number} hop    - hop size in seconds (default 0.01)
 */
export function closureMs(env, word, hop = 0.01) {
  const seg = env.slice(Math.round(word.start / hop), Math.round(word.end / hop));
  const peak = Math.max(...seg);
  const inner = seg.slice(Math.round(seg.length * 0.2), Math.round(seg.length * 0.75));
  let run = 0, best = 0;
  for (const v of inner) {
    if (v < peak - 35) { run++; best = Math.max(best, run); } else run = 0;
  }
  return best * hop * 1000;
}
