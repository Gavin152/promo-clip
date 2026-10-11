// vo sub-commands: generate, import, stt, qa, rank, process, timing, gaps.
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { readJson } from './lib/paths.mjs';
import { loadState } from './lib/state.mjs';
import { loadProviders } from './lib/cost.mjs';
import { parseScript } from './lib/script.mjs';
import { ffmpeg, analyse as ffmpegAnalyse, duration, decode, envelope } from './lib/audio.mjs';
import { paid, quote, setClient } from './lib/paid.mjs';
import { QaFail } from './lib/errors.mjs';
import { buildCanon, analyseTranscript, closureMs, buildSentences, brandNormalize } from './lib/vo-analyse.mjs';

export { setClient }; // re-export so tests can inject a fake client

export const USAGE = `  vo generate <name> [--voice V] [--model M] [--tag "[…]"] [--script F] [--takes N]
  vo import <file>                       convert your own recording → assets/vo/vo.wav
  vo stt [file]                          STT (WAV only); default: assets/vo/vo.wav
  vo qa <stt.json> [script.md]          word diff + pauses + brand closure; exit 2 on errors
  vo rank <take…>                        rank takes: diff < closure < pauses < duration
  vo process <take>                      trim/declip/HPF/fade/gain → assets/vo/vo.wav
  vo timing [--vo-start S]              timing.json from vo.aai.json + script (also seeds no-gaps pair)
  vo gaps [--min 0.85] [--max 1.0]      widen scene-boundary pauses in vo.wav (rebuilds from no-gaps)`;

// ── helpers ──────────────────────────────────────────────────────────────────

/**
 * Find the quietest 20 ms window inside a pause [s, e] (keeping 40 ms from each end).
 * Returns a timestamp (seconds) for the insertion point.
 */
function quietestSpot(env, s, e, hop = 0.01) {
  const iMin = Math.round((s + 0.04) / hop);
  const iMax = Math.round((e - 0.06) / hop);
  if (iMax <= iMin) return (s + e) / 2;
  let best = Infinity, at = (s + e) / 2;
  for (let k = iMin; k < iMax; k++) {
    const v = Math.max(env[k] ?? -100, env[k + 1] ?? -100);
    if (v < best) { best = v; at = (k + 1) * hop; }
  }
  return at;
}

// ── commands ─────────────────────────────────────────────────────────────────

/**
 * generate <name> [--voice V] [--model M] [--tag "[…]"] [--script F] [--takes N]
 *
 * Runs one full-script TTS take per call (no splicing).
 * Default model list = providers.tts.audition (both models are auditioned by default).
 * With --takes N: N takes per model; file names get a model-slug and index suffix.
 * PCM returned by the API is converted to 24 kHz mono WAV.
 * Saves: assets/vo_raw/<name>.wav + <name>.meta.json
 */
async function generate(ctx) {
  const { project, pos, flags, log } = ctx;
  const name = pos[0];
  if (!name) throw new Error('usage: vo generate <name>');

  const scriptPath = flags.script ?? join(project, 'script.md');
  const scriptMd = readFileSync(scriptPath, 'utf8');
  const script = parseScript(scriptMd);
  const tag = flags.tag ?? '';
  const ttsText = tag ? `${tag} ${script.ttsText}` : script.ttsText;
  const chars = ttsText.length;

  const state = loadState(project);
  const providers = loadProviders(project, state);
  const models = flags.model ? [flags.model] : providers.tts.audition;
  const voice = flags.voice ?? providers.tts.defaultVoice;
  const takes = Math.max(1, Number(flags.takes ?? 1));

  const rawDir = join(project, 'assets/vo_raw');
  mkdirSync(rawDir, { recursive: true });

  const results = [];
  for (const model of models) {
    const est = quote(project, 'tts', { chars }, takes, model);
    log(`estimate ${model} × ${takes}: $${est.usd.toFixed(4)}`);

    for (let t = 0; t < takes; t++) {
      // suffix only when multiple models or multiple takes
      const suffix = models.length > 1 || takes > 1
        ? `_${model.split('/').pop().replace(/[^a-z0-9]+/gi, '-')}_${t + 1}`
        : '';
      const takeName = name + suffix;

      const { reply, usd, model: usedModel } = await paid({
        project, stage: 'voice', need: 'tts', what: `vo generate ${takeName}`,
        params: { chars }, model,
        call: (m, c) => c.tts({ model: m, voice, input: ttsText, response_format: 'pcm' }),
        log,
      });

      // PCM (s16le 24 kHz mono) → WAV
      const wavPath = join(rawDir, `${takeName}.wav`);
      await ffmpeg(
        ['-y', '-loglevel', 'error', '-f', 's16le', '-ar', '24000', '-ac', '1', '-i', '-', wavPath],
        { stdin: (s) => { s.write(reply.audio); s.end(); } },
      );

      const meta = { model: usedModel, voice, tag: flags.tag ?? '', text: ttsText, cost: usd, at: new Date().toISOString() };
      writeFileSync(join(rawDir, `${takeName}.meta.json`), JSON.stringify(meta, null, 1) + '\n');
      log(`${takeName}: ${(reply.audio.length / 48000).toFixed(2)} s  $${usd.toFixed(4)}`);
      results.push({ name: takeName, path: wavPath, model: usedModel, voice, usd });
    }
  }
  return { takes: results };
}

/**
 * import <file>
 *
 * Converts any audio format to 24 kHz mono WAV and writes it to assets/vo/vo.wav.
 * Use this to bring in your own recording in place of a TTS take.
 */
async function voImport(ctx) {
  const { project, pos, log } = ctx;
  const file = pos[0];
  if (!file) throw new Error('usage: vo import <file>');
  const voDir = join(project, 'assets/vo');
  mkdirSync(voDir, { recursive: true });
  const out = join(voDir, 'vo.wav');
  await ffmpeg(['-y', '-loglevel', 'error', '-i', file, '-ar', '24000', '-ac', '1', '-c:a', 'pcm_s16le', out]);
  log(`imported → ${out}`);
  return { path: out };
}

/**
 * stt [file]
 *
 * Runs word-level STT on a WAV file (AssemblyAI universal-3-5-pro or whisper fallback).
 * Default file: assets/vo/vo.wav.
 * Non-WAV files are converted to WAV first (AssemblyAI requires WAV).
 * Output: <file>.aai.json next to the input file.
 */
async function stt(ctx) {
  const { project, pos, flags, log } = ctx;
  const file = pos[0] ?? join(project, 'assets/vo/vo.wav');

  // ensure WAV (AssemblyAI requires it)
  let wavFile = file;
  if (!file.toLowerCase().endsWith('.wav')) {
    wavFile = file.replace(/\.[^.]+$/, '_stt.wav');
    await ffmpeg(['-y', '-loglevel', 'error', '-i', file, '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', wavFile]);
    log(`converted to WAV: ${wavFile}`);
  }

  const secs = duration(wavFile);
  const buf = readFileSync(wavFile);

  const { reply, model, usd } = await paid({
    project, stage: 'voice', need: 'stt', what: 'stt',
    params: { seconds: secs },
    call: (m, c) => c.stt(buf, 'wav', m),
    log,
  });

  const outPath = file.replace(/(\.[^.]+)?$/, '.aai.json');
  writeFileSync(outPath, JSON.stringify(reply, null, 1) + '\n');
  log(`${model}: ${reply.words?.length ?? '?'} words, $${usd.toFixed(4)}`);
  return { path: outPath, words: reply.words?.length ?? null, model, usd };
}

/**
 * qa <stt.json> [script.md]
 *
 * Checks a transcript against the script:
 *   - word diff (Levenshtein edit ops)
 *   - mid-phrase pauses > 250 ms (no punctuation at that join)
 *   - brand-word closure (dip > 35 dB in middle of the word — cosmetic warning only)
 * Exits with code 2 (QaFail) if there are word errors.
 */
async function qa(ctx) {
  const { project, pos, flags, log } = ctx;
  const sttPath = pos[0];
  if (!sttPath) throw new Error('usage: vo qa <stt.json> [script.md]');
  const scriptPath = pos[1] ?? join(project, 'script.md');
  const theme = readJson(join(project, 'theme.json'), {});

  const sttData = JSON.parse(readFileSync(sttPath, 'utf8'));
  const ttsText = parseScript(readFileSync(scriptPath, 'utf8')).ttsText;
  const canon = buildCanon(theme);
  const r = analyseTranscript(sttData, ttsText, canon);

  const ms = (x) => Math.round(x * 1000);
  log(`speech ${r.first.toFixed(2)}–${r.last.toFixed(2)} s (${(r.last - r.first).toFixed(1)} s), ${r.nHyp} words, ${r.rate.toFixed(2)} w/s`);
  log(`script diff: ${r.ops.length ? r.ops.join('; ') : 'none'}`);
  if (r.longMid.length) log(`mid-phrase pauses: ${r.longMid.map((x) => `"${x.a}|${x.b}" ${ms(x.gap)} ms`).join(', ')}`);
  if (r.tight.length) log(`tight joins: ${r.tight.map((x) => `"${x.a}|${x.b}" ${ms(x.gap)} ms`).join(', ')}`);
  if (r.lowConf.length) log(`low confidence: ${r.lowConf.map((w) => `"${w.word}" ${w.conf?.toFixed(2)}`).join(', ')}`);

  // brand closure (warning only; ranks penalise it)
  const brandWords = theme.brandWords ?? [];
  if (brandWords.length) {
    const sttFile = sttPath.replace('.aai.json', '.wav');
    if (existsSync(sttFile)) {
      const env = envelope(decode(sttFile));
      const brandWarns = [];
      for (const bw of brandWords) {
        const w = sttData.words.find((x) => x.word.toLowerCase().replace(/[^a-z]/g, '') === bw.toLowerCase());
        if (w) {
          const cm = closureMs(env, w);
          if (cm > 50) brandWarns.push(`"${bw}" closure ${cm.toFixed(0)} ms`);
        }
      }
      if (brandWarns.length) log(`brand closure: ${brandWarns.join(', ')}`);
    }
  }

  if (r.ops.length > 0) throw new QaFail(`${r.ops.length} word error(s): ${r.ops.join('; ')}`, r);
  return r;
}

/**
 * rank <take…>
 *
 * Ranks takes objectively, best first:
 *   1. fewest diff errors
 *   2. smallest max brand-word closure (ms)
 *   3. fewest mid-phrase pauses
 *   4. shortest duration
 */
async function rank(ctx) {
  const { project, pos, flags, log } = ctx;
  const takes = pos;
  if (!takes.length) throw new Error('usage: vo rank <take…>');

  const scriptPath = join(project, 'script.md');
  const theme = readJson(join(project, 'theme.json'), {});
  const canon = buildCanon(theme);
  const brandWords = theme.brandWords ?? [];
  const ttsText = parseScript(readFileSync(scriptPath, 'utf8')).ttsText;

  const rows = [];
  for (const t of takes) {
    const base = join(project, 'assets/vo_raw', t);
    const sttData = JSON.parse(readFileSync(`${base}.aai.json`, 'utf8'));
    const r = analyseTranscript(sttData, ttsText, canon);
    const wavPath = `${base}.wav`;
    const brandClosure = [];
    if (existsSync(wavPath)) {
      const env = envelope(decode(wavPath));
      for (const bw of brandWords) {
        const w = sttData.words.find((x) => x.word.toLowerCase().replace(/[^a-z]/g, '') === bw.toLowerCase());
        if (w) brandClosure.push(closureMs(env, w));
      }
    }
    rows.push({ take: t, diff: r.ops.length, pauses: r.longMid.map((x) => Math.round(x.gap * 1000)), closure: brandClosure, end: +r.last.toFixed(2) });
  }

  rows.sort((a, b) =>
    a.diff - b.diff ||
    Math.max(0, ...a.closure) - Math.max(0, ...b.closure) ||
    a.pauses.length - b.pauses.length ||
    a.end - b.end);

  for (const r of rows)
    log(`${r.take.padEnd(12)} diff=${r.diff} closure_ms=[${r.closure.map(v => v.toFixed(0))}] midPauses=[${r.pauses}] end=${r.end}s`);

  return { ranked: rows };
}

/**
 * process <take>
 *
 * Non-destructive pipeline on a raw take → assets/vo/vo.wav:
 *   atrim (first word −100 ms / last word +450 ms), asetpts, adeclip,
 *   highpass f=70 Hz, 15 ms fade-in / 60 ms fade-out, peak gain to −1.5 dBTP.
 * Reads <take>.aai.json for word boundaries.
 * Uses ffmpeg helpers (no shell strings) so paths with spaces are safe.
 */
async function process(ctx) {
  const { project, pos, log } = ctx;
  const take = pos[0];
  if (!take) throw new Error('usage: vo process <take>');

  const rawDir = join(project, 'assets/vo_raw');
  const raw = join(rawDir, `${take}.wav`);
  const sttPath = join(rawDir, `${take}.aai.json`);
  const words = JSON.parse(readFileSync(sttPath, 'utf8')).words;
  if (!words?.length) throw new Error(`no words in ${sttPath}`);

  const PRE = 0.1, POST = 0.45;
  const a = Math.max(0, words[0].start - PRE);
  const b = words.at(-1).end + POST;
  const trimDur = b - a;

  const voDir = join(project, 'assets/vo');
  mkdirSync(voDir, { recursive: true });
  const out = join(voDir, 'vo.wav');
  const tmp = `${out}.tmp.wav`;

  const chain = [
    `atrim=${a.toFixed(3)}:${b.toFixed(3)}`,
    'asetpts=N/SR/TB',
    'adeclip',
    'highpass=f=70:p=1',
    'afade=t=in:d=0.015',
    `afade=t=out:st=${(trimDur - 0.06).toFixed(3)}:d=0.06`,
  ].join(',');
  await ffmpeg(['-y', '-loglevel', 'error', '-i', raw, '-af', chain, '-ar', '24000', '-ac', '1', tmp]);

  // peak-normalise to −1.5 dBTP (pure gain; programme loudness set at mix time)
  const vd = ffmpegAnalyse(tmp, 'volumedetect');
  const peak = parseFloat(vd.match(/max_volume: ([-\d.]+) dB/)?.[1] ?? '0');
  const gain = -1.5 - peak;
  await ffmpeg(['-y', '-loglevel', 'error', '-i', tmp, '-af', `volume=${gain.toFixed(2)}dB`, '-ar', '24000', '-c:a', 'pcm_s16le', out]);

  unlinkSync(tmp);

  log(`trim ${a.toFixed(3)}–${b.toFixed(3)} s (${trimDur.toFixed(3)} s); peak ${peak} dB, gain ${gain.toFixed(2)} dB → ${out}`);
  return { path: out, trim: { start: a, end: b }, peak, gain };
}

/**
 * timing [--vo-start S]
 *
 * Builds vo/timing.json from assets/vo/vo.aai.json + script.md.
 * Word times keep the script spelling; brand words are capitalised.
 * Also creates the no-gaps baseline pair:
 *   assets/vo/vo_nogaps.wav  ←  copy of assets/vo/vo.wav
 *   vo/timing_nogaps.json    ←  copy of vo/timing.json
 * Run "vo gaps" after this to widen scene-boundary pauses.
 */
async function timing(ctx) {
  const { project, pos, flags, log } = ctx;
  const voStart = Number(flags['vo-start'] ?? 0.6);

  const sttPath = join(project, 'assets/vo/vo.aai.json');
  const scriptPath = join(project, 'script.md');
  const theme = readJson(join(project, 'theme.json'), {});
  const brandWords = theme.brandWords ?? [];

  const sttData = JSON.parse(readFileSync(sttPath, 'utf8'));
  const scriptMd = readFileSync(scriptPath, 'utf8');
  const canon = buildCanon(theme);
  const r = analyseTranscript(sttData, parseScript(scriptMd).ttsText, canon);
  if (r.ops.length) log(`warning: ${r.ops.length} diff error(s): ${r.ops.join('; ')}`);

  const state = loadState(project);
  const providers = loadProviders(project, state);
  const transcriber = sttData.model ?? providers.stt?.default ?? 'assemblyai/universal-3-5-pro';

  // Build words from aligned hypothesis — use original STT word text + brand capitalisation
  const words = r.words.map((w, i) => ({
    i,
    w: brandNormalize(w.word, brandWords),
    start: +w.start.toFixed(3),
    end: +w.end.toFixed(3),
    conf: w.conf != null ? +w.conf.toFixed(3) : null,
  }));
  const sentences = buildSentences(words);
  const voPath = join(project, 'assets/vo/vo.wav');
  const dur = duration(voPath);

  const timingData = {
    source: 'assets/vo/vo.wav',
    transcriber,
    vo_start: voStart,
    duration: +dur.toFixed(3),
    note: 'word times are seconds relative to vo.wav; film time = vo_start + t',
    sentences,
    words,
  };

  const voDir = join(project, 'vo');
  mkdirSync(voDir, { recursive: true });
  const timingPath = join(voDir, 'timing.json');
  writeFileSync(timingPath, JSON.stringify(timingData, null, 1) + '\n');

  // seed no-gaps baseline (gaps command always rebuilds from these)
  const nogapsWav = join(project, 'assets/vo/vo_nogaps.wav');
  copyFileSync(voPath, nogapsWav);
  const nogapsJson = join(voDir, 'timing_nogaps.json');
  writeFileSync(nogapsJson, JSON.stringify({ ...timingData, source: 'assets/vo/vo_nogaps.wav' }, null, 1) + '\n');

  log(`timing.json: ${words.length} words, ${sentences.length} sentences, ${dur.toFixed(2)} s @ film ${voStart} s`);
  return { words: words.length, sentences: sentences.length, duration: timingData.duration, vo_start: voStart };
}

/**
 * gaps [--min 0.85] [--max 1.0]
 *
 * Widens ONLY the scene-boundary pauses (from parseScript().boundaries) by inserting
 * silence at the quietest 20 ms inside each pause. Always rebuilds from the no-gaps
 * baseline (assets/vo/vo_nogaps.wav + vo/timing_nogaps.json) so it is safe to re-run.
 *
 * --max S  target pause duration in seconds (default 1.0); gaps already at or above
 *           this value are skipped.
 * --min S  minimum acceptable pause (default 0.85); documents intent but does not
 *           change the target (all boundaries are widened to --max).
 *
 * Output: assets/vo/vo.wav + vo/timing.json (overwrites; nogaps pair is unchanged).
 */
async function gaps(ctx) {
  const { project, pos, flags, log } = ctx;
  const maxTarget = Number(flags.max ?? 1.0);

  const srcWav = join(project, 'assets/vo/vo_nogaps.wav');
  const srcJson = join(project, 'vo/timing_nogaps.json');
  const scriptPath = join(project, 'script.md');
  if (!existsSync(srcWav)) throw new Error(`missing ${srcWav} — run "vo timing" first`);
  if (!existsSync(srcJson)) throw new Error(`missing ${srcJson} — run "vo timing" first`);

  const t0 = JSON.parse(readFileSync(srcJson, 'utf8'));
  const boundaries = parseScript(readFileSync(scriptPath, 'utf8')).boundaries;

  // decode at 24 kHz (the processing SR)
  const SR = 24000, HOP = 0.01;
  const x = decode(srcWav, SR);
  const env = envelope(x, SR, HOP);
  const W = t0.words;

  // compute insertion amounts (pure), then add the quietest-spot position
  const bare = (s) => s.replace(/[^a-z]/gi, '').toLowerCase();
  const plan = computeGapInsertions(W, boundaries, maxTarget);
  for (const b of boundaries) {
    if (!plan.find((c) => bare(c.after) === bare(b.after))) {
      const skip = W.find((w) => bare(w.w) === bare(b.after));
      if (!skip) log(`warning: boundary "${b.after} | ${b.before}" not found in timing`);
      // already at target → skip silently
    }
  }
  const cuts = plan.map((c) => {
    const i = c.wordIdx - 1;
    const s = W[i].end, e = W[i + 1].start;
    const at = +quietestSpot(env, s, e, HOP).toFixed(3);
    return { ...c, at };
  });

  // assemble: insert silence at each cut point (ascending order of at)
  cuts.sort((a, c) => a.at - c.at);
  const parts = [];
  let pos0 = 0;
  for (const c of cuts) {
    const k = Math.round(c.at * SR);
    parts.push(x.subarray(pos0, k), new Float32Array(Math.round(c.added * SR)));
    pos0 = k;
  }
  parts.push(x.subarray(pos0));

  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }

  const dstWav = join(project, 'assets/vo/vo.wav');
  await ffmpeg(
    ['-y', '-loglevel', 'error', '-f', 'f32le', '-ar', String(SR), '-ac', '1', '-i', '-', '-c:a', 'pcm_s16le', dstWav],
    { stdin: (s) => { const buf = Buffer.from(out.buffer); s.write(buf); s.end(); } },
  );

  // shift timing
  const shift = (t) => +(t + cuts.filter((c) => c.at <= t).reduce((s, c) => s + c.added, 0)).toFixed(3);
  const words = W.map((w) => ({ ...w, start: shift(w.start), end: shift(w.end) }));
  const sentences = (t0.sentences ?? []).map((s) => ({ ...s, start: shift(s.start), end: shift(s.end) }));
  const total = cuts.reduce((s, c) => s + c.added, 0);
  const newDur = +(t0.duration + total).toFixed(3);

  writeFileSync(join(project, 'vo/timing.json'), JSON.stringify({
    ...t0,
    source: `assets/vo/vo.wav (vo_nogaps.wav + scene pauses, vo gaps)`,
    duration: newDur,
    gaps: cuts.map(({ wordIdx: _, ...c }) => c),
    sentences, words,
  }, null, 1) + '\n');

  for (const c of cuts)
    log(`"${c.after} | ${c.before}" +${c.added.toFixed(2)} s at ${c.at.toFixed(3)} s`);
  log(`inserted ${total.toFixed(2)} s total; vo now ${newDur.toFixed(2)} s`);
  return { cuts, total, duration: newDur };
}

// ── pure export (used by tests) ───────────────────────────────────────────────

/**
 * Compute which scene-boundary pauses need widening and by how much.
 * Pure: no I/O, no audio decoding. Used by the gaps command and tests.
 *
 * @param {Array}  words      - timing_nogaps.json words: [{w, start, end, …}]
 * @param {Array}  boundaries - parseScript().boundaries: [{after, before, …}]
 * @param {number} maxTarget  - target gap duration in seconds (default 1.0)
 * @returns {Array} cuts: [{after, before, added, wordIdx}] — skips gaps already at/above target
 */
export function computeGapInsertions(words, boundaries, maxTarget = 1.0) {
  const bare = (s) => s.replace(/[^a-z]/gi, '').toLowerCase();
  const cuts = [];
  for (const b of boundaries) {
    const i = words.findIndex((w, k) =>
      bare(w.w) === bare(b.after) && words[k + 1] && bare(words[k + 1].w) === bare(b.before));
    if (i < 0) continue;
    const current = words[i + 1].start - words[i].end;
    const add = +(maxTarget - current).toFixed(3);
    if (add <= 0.01) continue;
    cuts.push({ after: b.after, before: b.before, added: add, wordIdx: i + 1 });
  }
  return cuts;
}

// ── export ───────────────────────────────────────────────────────────────────

export const commands = {
  generate,
  import: voImport,
  stt,
  qa,
  rank,
  process,
  timing,
  gaps,
};
