// Pure timeline data logic (no JSON imports, so it is unit-testable in Node).
// makeData(timing, cues) builds the word and music lookups that data.js exports.
//  - timing: vo/timing.json  { vo_start, words:[{w,start,end}], sentences:[{text,start}], tail?, maxDuration? }
//  - cues:   assets/music/cues.json  { offset, beatPeriod, beats, downbeats, film:{reveal,final,end}, accents, mix }

/** word key: lower case, letters/digits plus . € $ £ ' kept, trailing '.' dropped ("Wi-Fi," -> "wifi", "€19.90" stays) */
export const wordKey = (s) => String(s).toLowerCase().replace(/[^\p{L}\p{N}€$£.']/gu, '').replace(/\.+$/, '');

export function makeData(TIMING, CUES) {
  const VO_START = TIMING.vo_start ?? 0;
  const WORDS = TIMING.words.map((w) => ({ ...w, key: wordKey(w.w), t: VO_START + w.start, e: VO_START + w.end }));
  const hitsOf = (word) => {
    const k = wordKey(word);
    return WORDS.filter((w) => w.key === k);
  };
  /** film start time of the nth occurrence of a word (exact match after normalisation, never a prefix) */
  function W(word, nth = 0) {
    const h = hitsOf(word)[nth];
    if (!h) throw new Error(`word "${word}" #${nth} not in timing.json`);
    return h.t;
  }
  /** film end time of the nth occurrence of a word */
  function WE(word, nth = 0) {
    const h = hitsOf(word)[nth];
    if (!h) throw new Error(`word "${word}" #${nth} not in timing.json`);
    return h.e;
  }
  /** film start time of the first occurrence of a word at/after time `after` */
  function Wa(word, after) {
    const k = wordKey(word);
    const w = WORDS.find((x) => x.key === k && x.t >= after - 0.01);
    if (!w) throw new Error(`word "${word}" after ${after} not in timing.json`);
    return w.t;
  }
  /** film time of the first word of the sentence containing `phrase` */
  function S(phrase) {
    const s = (TIMING.sentences ?? []).find((x) => x.text.toLowerCase().includes(phrase.toLowerCase()));
    if (!s) throw new Error(`sentence "${phrase}" not in timing.json`);
    return VO_START + s.start;
  }

  // ---- music (film time)
  const MOFF = CUES.offset ?? 0;
  const BEAT = CUES.beatPeriod ?? 0.5;
  const BEATS = (CUES.beats ?? []).map((b) => b + MOFF);
  const DOWNBEATS = (CUES.downbeats ?? []).map((b) => b + MOFF);
  const HIT = CUES.film ?? {}; // { reveal, final, end }
  const ACCENTS = CUES.accents ?? []; // [{film, change}]
  /** music accent nearest to t (within tol), else t: visual accents follow the music (±150 ms rule) */
  function accent(t, tol = 0.6) {
    let best = t, bd = tol;
    for (const a of ACCENTS) { const d = Math.abs(a.film - t); if (d < bd) { bd = d; best = a.film; } }
    return best;
  }
  /** nearest beat to t within tol (default ±150 ms) */
  function onBeat(t, tol = 0.15) {
    let best = t, bd = tol;
    for (const b of BEATS) { const d = Math.abs(b - t); if (d < bd) { bd = d; best = b; } if (b > t + tol) break; }
    return best;
  }
  /** the k-th beat at or after t */
  function beatFrom(t, k = 0) {
    const i = BEATS.findIndex((b) => b >= t - 0.02);
    return i < 0 ? t + k * BEAT : BEATS[Math.min(BEATS.length - 1, i + k)] ?? t + k * BEAT;
  }

  // film length: last word + tail (default 3 s), or the music end if later; optional hard cap
  const lastWord = WORDS.length ? WORDS[WORDS.length - 1].e : 0;
  let DURATION = Math.max(lastWord + (TIMING.tail ?? 3), (HIT.end ?? 0) + 0.2);
  if (TIMING.maxDuration) DURATION = Math.min(TIMING.maxDuration, DURATION);

  return { TIMING, CUES, VO_START, WORDS, W, WE, Wa, S, MOFF, BEAT, BEATS, DOWNBEATS, HIT, ACCENTS, accent, onBeat, beatFrom, DURATION };
}
