// music sub-commands: generate, cues, import (alias: swap), mix, check.
// Ported from promo02/tools/music-{generate,cues,swap}.mjs + mix-{tune,check}.mjs.
// SailTrax-specific hardcoding removed; story beats come from vo/timing.json + script.md.
import { readFileSync, writeFileSync, existsSync, copyFileSync, unlinkSync, mkdirSync } from 'node:fs';
import { join, extname, basename, resolve } from 'node:path';
import { decode, loudness as ffmpegLoudness } from './lib/audio.mjs';
import { readJson } from './lib/paths.mjs';
import { paid, quote } from './lib/paid.mjs';
import { QaFail } from './lib/errors.mjs';
import { exportVideo } from './export.mjs';
import { parseScript } from './lib/script.mjs';
import { wordKey } from '../js/data-core.js';
import {
  SR, FPS,
  analyseSignal, tempo, beatGrid, downbeats as computeDownbeats,
  hits, barProfile, liftAt,
} from './lib/music-dsp.mjs';

export const USAGE = `\
  music generate [name] [--style "…"|--prompt F] [--n N]   generate music candidates (Lyria)
  music cues [file] [--analyse-only] [--target w[#n]] [--reveal w[#n]]
                                                            BPM/beats/placement → cues.json
  music import <file> [--keep-mix]                         install track + run cues
  music swap   <file> [--keep-mix]                         alias for import
  music mix                                                auto-balance VO vs music (stems)
  music check                                              mix balance QA report (exit 2 if off)`;

// ---------------------------------------------------------------- helpers

/** return { word, idx } from a "word[#n]" flag value, or null */
function parseWordRef(s) {
  if (!s) return null;
  const m = /^(.+)#(\d+)$/.exec(s);
  return m ? { word: m[1], idx: Number(m[2]) } : { word: s, idx: 0 };
}

/** find project's assets/music/track.{mp3,wav,m4a,ogg} */
function findTrack(project) {
  for (const e of ['mp3', 'wav', 'm4a', 'ogg']) {
    const p = join(project, 'assets/music', `track.${e}`);
    if (existsSync(p)) return p;
  }
  return null;
}

/** film start time of word[idx] in timing.json; throws if not found */
function wordFilmTime(timing, word, idx = 0) {
  const k = wordKey(word);
  const matches = timing.words.filter((w) => wordKey(w.w) === k);
  if (!matches[idx]) throw new Error(`word "${word}" #${idx} not found in vo/timing.json`);
  return timing.vo_start + matches[idx].start;
}

/** read vo/timing.json; returns null if not found */
function loadTiming(project) {
  const p = join(project, 'vo/timing.json');
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null;
}

/** last spoken word (string) from script.md; null if no script */
function lastScriptWord(project) {
  const p = join(project, 'script.md');
  if (!existsSync(p)) return null;
  const parsed = parseScript(readFileSync(p, 'utf8'));
  return parsed.words.at(-1) ?? null;
}

/** first word of scene 2 (string) from script.md, if ≥3 scenes; else null */
function scene2FirstWord(project) {
  const p = join(project, 'script.md');
  if (!existsSync(p)) return null;
  const parsed = parseScript(readFileSync(p, 'utf8'));
  if (parsed.scenes.length < 3) return null;
  return parsed.scenes[1]?.words[0] ?? null;
}

// ---------------------------------------------------------------- full DSP analysis (needs ffmpeg)

/**
 * decode + analyse a track file; returns { file, dur, bpm, period, firstDownbeat,
 *   downbeats, beats (numbers), hits, loudness, spectrum, _raw: { x, A, G, D, bars } }
 */
async function analyseTrack(trackFile) {
  const x = decode(trackFile, SR); // mono Float32Array at 22050 Hz (DSP SR)
  const dur = x.length / SR;
  const A = analyseSignal(x);
  const bpm0 = tempo(A.on, A.nF);
  const G = beatGrid(A.on, A.nF, bpm0, A.low);
  const D = computeDownbeats(G.beats, A.low, A.on);
  const beatTimes = G.beats.map((b) => b.t);
  const H = hits(A.rms, A.on, A.nF, dur, beatTimes, D.downbeats);
  const L = ffmpegLoudness(trackFile);
  const bars = barProfile(x, D.downbeats, G.period);
  return {
    file: basename(trackFile),
    dur: +dur.toFixed(3),
    bpm: G.bpm,
    beatPeriod: +G.period.toFixed(4),
    firstDownbeat: D.downbeats[0] ?? 0,
    downbeats: D.downbeats,
    beats: beatTimes.map((t) => +t.toFixed(3)),
    hits: H,
    loudness: L,
    spectrum: A.bands,
    _raw: { x, A, G, D, bars },
  };
}

// ---------------------------------------------------------------- placement algorithm

/**
 * place a track on the film timeline:
 *   offset = targetFilm - finalHit  (single time shift, no stretching)
 * Returns { offset, reveal (track time), revealLiftDb, storyBeats, alignmentError, accents, manual }
 */
function placeCues(analysis, { targetFilm, revealFilm = null, prevCues = {} }) {
  const { hits: H, downbeats: dbs, beats, _raw: { bars } } = analysis;
  const manual = prevCues.manual ?? {};

  const final = manual.final ?? H.final;
  const offset = manual.offset ?? +(targetFilm - final).toFixed(3);

  let reveal = manual.reveal ?? null;
  let revealLiftDb = null;

  if (reveal == null && revealFilm != null) {
    // largest bar lift whose film time falls in [revealFilm-1.5, revealFilm+2.2]
    let best = -99;
    bars.forEach((b, i) => {
      const ft = b.t + offset;
      if (ft < revealFilm - 1.5 || ft > revealFilm + 2.2) return;
      const l = liftAt(bars, i);
      if (l > best) { best = l; reveal = b.t; revealLiftDb = +l.toFixed(1); }
    });
    if (reveal == null) {
      // no bar in window: nearest downbeat to revealFilm
      reveal = dbs.length ? dbs.reduce((p, c) => (Math.abs(c + offset - revealFilm) < Math.abs(p + offset - revealFilm) ? c : p)) : 0;
    }
    // weak lift (<3 dB): snap to beat just before reveal word
    if (revealLiftDb == null || revealLiftDb < 3) {
      const want = revealFilm - 0.25;
      reveal = beats.reduce((p, c) => (Math.abs(c + offset - want) < Math.abs(p + offset - want) ? c : p), beats[0] ?? 0);
      revealLiftDb = null;
    }
  } else if (reveal == null) {
    // no reveal word: default to first downbeat
    reveal = dbs[0] ?? 0;
  }

  const revealErr = +((offset + reveal) - (revealFilm ?? offset + reveal)).toFixed(3);
  const finalErr = +((offset + final) - targetFilm).toFixed(3);

  const accents = bars
    .map((b, i) => ({ film: +(b.t + offset).toFixed(3), track: +b.t.toFixed(3), change: +liftAt(bars, i).toFixed(1) }))
    .filter((a, i) => i > 0 && Math.abs(a.change) >= 3);

  return {
    offset,
    reveal: +reveal.toFixed(3),
    revealLiftDb,
    storyBeats: { reveal: revealFilm != null ? +revealFilm.toFixed(3) : null, final: +targetFilm.toFixed(3) },
    alignmentError: { reveal: revealErr, final: finalErr },
    accents,
    manual,
  };
}

// ---------------------------------------------------------------- ranking score for --analyse-only

/**
 * Composite ranking score 0–100:
 *   40 pts – reveal lift  (0 dB → 0, 10 dB → 40, clamped)
 *   40 pts – placement accuracy  (0 s err → 40, halflife 0.3 s)
 *   20 pts – energy match  (–14 LUFS target; ±14 dB envelope)
 */
function rankingScore({ revealLiftDb, alignmentError, lufs }) {
  const revealPts = Math.min(40, Math.max(0, (revealLiftDb ?? 0) * 4));
  const placePts = 40 * Math.exp(-Math.abs(alignmentError?.final ?? 0) / 0.3);
  const energyPts = 20 * Math.max(0, 1 - Math.abs((lufs ?? -30) + 14) / 14);
  return Math.round(revealPts + placePts + energyPts);
}

// ---------------------------------------------------------------- commands

/** generate [name] [--style "…"|--prompt F] [--n N]  → assets/music/alternates/<name>.<ext> */
async function generate({ project, pos, flags, log, json }) {
  const name = pos[0] ?? `lyria_${Date.now()}`;
  const n = flags.n ? Number(flags.n) : 1;

  // build prompt
  let prompt;
  if (flags.prompt) {
    prompt = readFileSync(resolve(flags.prompt), 'utf8');
  } else if (flags.style) {
    prompt = flags.style;
  } else {
    // extract ## Music section from brief.md, or fallback to generic
    const briefPath = join(project, 'brief.md');
    if (existsSync(briefPath)) {
      const md = readFileSync(briefPath, 'utf8');
      const m = /^##\s+music\b[^\n]*/im.exec(md);
      if (m) {
        const start = m.index, end = md.indexOf('\n## ', start + 4);
        prompt = md.slice(start, end < 0 ? undefined : end).replace(/^##[^\n]*\n/, '').trim();
      }
    }
    if (!prompt) {
      // read name from promo.json for a generic style prompt
      const promo = readJson(join(project, 'promo.json'), {});
      const productName = promo.name ?? '';
      prompt = `Upbeat modern background music${productName ? ` for ${productName}` : ''}. Energetic, positive, cinematic.`;
    }
  }

  const altDir = join(project, 'assets/music/alternates');
  mkdirSync(altDir, { recursive: true });

  // show estimate
  const est = quote(project, 'music', {}, n);
  log(`estimated cost: $${est.usd.toFixed(3)} × ${n} using ${est.model}`);
  if (flags['dry-run']) return { dryRun: true, model: est.model, usd: est.usd, n };

  const results = [];
  for (let i = 0; i < n; i++) {
    const tag = n > 1 ? `${name}_${i + 1}` : name;
    log(`generating ${tag}…`);
    const { model, reply } = await paid({
      project, stage: 'music', need: 'music', what: `music generation (${tag})`,
      params: {},
      call: (m, client) => client.chatStream({
        model: m,
        messages: [{ role: 'user', content: prompt }],
        modalities: ['text', 'audio'],
      }),
      log,
    });
    if (!reply.audio) throw new Error('no audio in response');
    // detect format: WAV starts with RIFF, MP3 starts with ID3 or 0xFF
    const ext = reply.audio.slice(0, 4).toString() === 'RIFF' ? 'wav'
      : (reply.audio.slice(0, 3).toString() === 'ID3' || reply.audio[0] === 0xff) ? 'mp3' : 'wav';
    const audioPath = join(altDir, `${tag}.${ext}`);
    writeFileSync(audioPath, reply.audio);
    writeFileSync(join(altDir, `${tag}.meta.json`), JSON.stringify({ prompt, model, text: reply.text?.slice(0, 400), usage: reply.usage, id: reply.id }, null, 1));
    log(`saved ${audioPath} (${(reply.audio.length / 1e6).toFixed(1)} MB)`);
    results.push({ name: tag, path: audioPath, model });
  }
  return results.length === 1 ? results[0] : results;
}

// ----------------------------------------------------------------

/**
 * cues [file] [--analyse-only] [--target w[#n]] [--reveal w[#n]]
 * Without --analyse-only: writes cues.json and returns the cues object.
 * With --analyse-only: returns analysis + rankingScore, writes nothing.
 */
async function cuesCommand({ project, pos, flags, log }) {
  const trackFile = pos[0] ?? findTrack(project);
  if (!trackFile || !existsSync(trackFile)) throw new Error('no track file found; pass the path or run `music import`');

  log(`analysing ${basename(trackFile)}…`);
  const analysis = await analyseTrack(trackFile);
  log(`${analysis.file}: ${analysis.dur.toFixed(2)} s, ${analysis.bpm} BPM, ${analysis.loudness.lufs} LUFS`);

  // target word and time
  const targetRef = parseWordRef(flags.target) ?? { word: lastScriptWord(project), idx: 0 };
  const revealRef = parseWordRef(flags.reveal) ?? { word: scene2FirstWord(project), idx: 0 };

  const timing = loadTiming(project);

  let targetFilm = null, revealFilm = null;
  if (timing) {
    if (targetRef?.word) {
      try { targetFilm = wordFilmTime(timing, targetRef.word, targetRef.idx); }
      catch (e) { log(`warning: ${e.message}; cannot place track`); }
    }
    if (revealRef?.word) {
      try { revealFilm = wordFilmTime(timing, revealRef.word, revealRef.idx); }
      catch (e) { log(`note: reveal word not found (${e.message}), using track reveal`); }
    }
  }

  if (flags['analyse-only']) {
    // no placement needed to produce the analysis report
    const { _raw: _, ...analysisOut } = analysis;
    let placement = null;
    if (targetFilm != null) {
      placement = placeCues(analysis, { targetFilm, revealFilm });
    }
    const score = rankingScore({
      revealLiftDb: placement?.revealLiftDb ?? analysis.hits.revealLiftDb,
      alignmentError: placement?.alignmentError ?? { final: 0 },
      lufs: analysis.loudness.lufs,
    });
    const { downbeats: dbs, beats, ...rest } = analysisOut;
    log(JSON.stringify({ ...rest, downbeats: dbs.slice(0, 6).concat(dbs.length > 6 ? ['…'] : []), score, placement }, null, 1));
    return { analysis: { ...rest, downbeats: dbs, beats }, placement, score };
  }

  if (targetFilm == null) throw new Error('no timing.json or target word; cannot place track (run `vo timing` first or pass --target)');

  const cuesPath = join(project, 'assets/music/cues.json');
  const prevCues = existsSync(cuesPath) ? JSON.parse(readFileSync(cuesPath, 'utf8')) : {};
  const pl = placeCues(analysis, { targetFilm, revealFilm, prevCues });

  const mix = (flags['keep-mix'] && prevCues.mix) ? prevCues.mix : {
    bedDb: -9, duckDb: -21, attack: 0.18, release: 0.6, lookahead: 0.15, mergeGap: 0.7,
    sections: [], fadeIn: pl.offset < -0.2 ? 1.2 : 0.05, fadeOut: 0.8,
  };

  const cues = {
    track: basename(trackFile),
    source: prevCues.source ?? null,
    analysed: analysis.file,
    bpm: analysis.bpm,
    beatPeriod: analysis.beatPeriod,
    firstDownbeat: analysis.firstDownbeat,
    offset: pl.offset,
    hits: { reveal: pl.reveal, final: analysis.hits.final, end: analysis.hits.end },
    film: {
      reveal: +(pl.offset + pl.reveal).toFixed(3),
      final: +(pl.offset + analysis.hits.final).toFixed(3),
      end: +(pl.offset + analysis.hits.end).toFixed(3),
    },
    storyBeats: pl.storyBeats,
    alignmentError: pl.alignmentError,
    accents: pl.accents,
    downbeats: analysis.downbeats,
    beats: analysis.beats,
    mix,
    manual: pl.manual,
    loudness: analysis.loudness,
    spectrum: analysis.spectrum,
  };

  mkdirSync(join(project, 'assets/music'), { recursive: true });
  writeFileSync(cuesPath, JSON.stringify(cues, null, 1));
  log(`cues.json written: offset ${cues.offset} s, film final ${cues.film.final} s, reveal err ${pl.alignmentError.reveal} s`);
  const { beats: _b, downbeats: _d, ...cuesOut } = cues;
  return cuesOut;
}

// ----------------------------------------------------------------

/** import <file> [--keep-mix]  — install track, analyse, write cues.json */
async function importCommand({ project, pos, flags, log }) {
  const src = pos[0];
  if (!src || !existsSync(src)) throw new Error('usage: music import <audio-file>');

  const musicDir = join(project, 'assets/music');
  mkdirSync(musicDir, { recursive: true });

  // remove existing track.*
  for (const e of ['mp3', 'wav', 'm4a', 'ogg']) {
    const p = join(musicDir, `track.${e}`);
    if (existsSync(p)) unlinkSync(p);
  }

  const ext = extname(src).slice(1).toLowerCase() || 'mp3';
  const dest = join(musicDir, `track.${ext}`);
  copyFileSync(src, dest);
  log(`installed ${basename(src)} → track.${ext}`);

  // patch existing cues.json source + clear manual (unless keep-mix)
  const cuesPath = join(musicDir, 'cues.json');
  if (existsSync(cuesPath)) {
    const c = JSON.parse(readFileSync(cuesPath, 'utf8'));
    if (!flags['keep-mix']) { c.mix = undefined; c.manual = {}; }
    c.source = basename(src);
    writeFileSync(cuesPath, JSON.stringify(c, null, 1));
  }

  return cuesCommand({ project, pos: [dest], flags: { ...flags, 'analyse-only': false }, log });
}

// ----------------------------------------------------------------

/**
 * mix — render stems (exportVideo audioOnly+stems) then auto-balance
 * Port of mix-tune.mjs: shifts duckDb so the median phrase sits TARGET dB above VO.
 */
async function mixCommand({ project, pos: _p, flags, log }) {
  const TARGET = flags.target ? Number(flags.target) : 13.5;
  const TOL = flags.tol ? Number(flags.tol) : 1.5;
  log('rendering audio stems…');
  const render = await exportVideo(project, { audioOnly: true, stems: true, noBuild: !!flags['no-build'], quiet: flags.quiet });
  const voWav = render.stems.vo, muWav = render.stems.music;

  const SR16 = 16000;
  const vo = decode(voWav, SR16), mu = decode(muWav, SR16);

  const timing = loadTiming(project);
  if (!timing) throw new Error('vo/timing.json not found');

  const rms = (x, a, b) => {
    let s = 0;
    const i0 = Math.round(a * SR16), i1 = Math.min(x.length, Math.round(b * SR16));
    for (let i = i0; i < i1; i++) s += x[i] * x[i];
    return 10 * Math.log10(s / Math.max(1, i1 - i0) + 1e-12);
  };

  // merge word runs into speech regions
  const regions = [];
  for (const w of timing.words) {
    const a = timing.vo_start + w.start, b = timing.vo_start + w.end, last = regions.at(-1);
    if (last && a - last[1] < 0.35) last[1] = b; else regions.push([a, b]);
  }
  const phrases = regions.filter(([a, b]) => b - a > 0.5).map(([a, b]) => ({ a, b, d: rms(vo, a, b) - rms(mu, a, b) }));
  const ds = phrases.map((p) => p.d).sort((x, y) => x - y);
  const med = ds[Math.floor(ds.length / 2)];
  const shift = +(med - TARGET).toFixed(1);

  const cuesPath = join(project, 'assets/music/cues.json');
  const cues = JSON.parse(readFileSync(cuesPath, 'utf8'));
  cues.mix.duckDb = +(cues.mix.duckDb + shift).toFixed(1);
  const secs = (cues.mix.sections ?? []);
  let n = 0;
  for (const p of phrases) {
    const r = p.d - med;
    if (Math.abs(r) <= TOL) continue;
    const from = +(p.a - 0.15).toFixed(2), to = +p.b.toFixed(2);
    const ex = secs.find((s) => s.auto && Math.abs(s.from - from) < 0.05 && Math.abs(s.to - to) < 0.05);
    const db = Math.max(-10, Math.min(8, +(r + (ex?.db ?? 0)).toFixed(1)));
    if (ex) ex.db = db; else secs.push({ from, to, db, auto: true });
    n++;
  }
  cues.mix.sections = secs.sort((x, y) => x.from - y.from);
  writeFileSync(cuesPath, JSON.stringify(cues, null, 1));
  const msg = `median VO-over-music ${med.toFixed(1)} dB (target ${TARGET}) → duckDb ${cues.mix.duckDb} (${shift >= 0 ? '+' : ''}${shift}); ${n} phrase trims; range ${ds[0].toFixed(1)}..${ds.at(-1).toFixed(1)} dB`;
  log(msg);
  return { median: +med.toFixed(1), target: TARGET, duckDb: cues.mix.duckDb, shift, phrases: n };
}

// ----------------------------------------------------------------

/**
 * check — render stems then verify balance; exit 2 if off by >TOL dB.
 * Port of mix-check.mjs.
 */
async function checkCommand({ project, pos: _p, flags, log }) {
  const TARGET = 13.5, TOL = 2.0;
  log('rendering audio stems for check…');
  const render = await exportVideo(project, { audioOnly: true, stems: true, noBuild: !!flags['no-build'], quiet: flags.quiet });
  const voWav = render.stems.vo, muWav = render.stems.music;

  const SR16 = 16000;
  const vo = decode(voWav, SR16), mu = decode(muWav, SR16);

  const timing = loadTiming(project);
  if (!timing) throw new Error('vo/timing.json not found');

  const rms = (x, a, b) => {
    let s = 0;
    const i0 = Math.round(a * SR16), i1 = Math.min(x.length, Math.round(b * SR16));
    for (let i = i0; i < i1; i++) s += x[i] * x[i];
    return 10 * Math.log10(s / Math.max(1, i1 - i0) + 1e-12);
  };

  const regions = [];
  for (const w of timing.words) {
    const a = timing.vo_start + w.start, b = timing.vo_start + w.end, last = regions.at(-1);
    if (last && a - last[1] < 0.35) last[1] = b; else regions.push([a, b]);
  }
  const diffs = regions.filter(([a, b]) => b - a > 0.5).map(([a, b]) => ({ a, b, vo: rms(vo, a, b), mu: rms(mu, a, b) }));
  diffs.forEach((d) => (d.d = d.vo - d.mu));
  const ds = diffs.map((d) => d.d).sort((x, y) => x - y);
  const med = ds[Math.floor(ds.length / 2)];
  log(`VO above music while speaking: median ${med.toFixed(1)} dB, min ${ds[0].toFixed(1)} dB, max ${ds.at(-1).toFixed(1)} dB over ${ds.length} phrases`);

  const offPhrases = diffs.filter((d) => d.d < TARGET - TOL || d.d > TARGET + TOL);
  for (const d of offPhrases) log(`  ${d.a.toFixed(1)}–${d.b.toFixed(1)} s: ${d.d.toFixed(1)} dB`);

  const report = { median: +med.toFixed(1), min: +ds[0].toFixed(1), max: +ds.at(-1).toFixed(1), target: TARGET, tol: TOL, phrases: ds.length, offPhrases: offPhrases.length };
  if (Math.abs(med - TARGET) > TOL) throw new QaFail(`VO-over-music median ${med.toFixed(1)} dB is more than ${TOL} dB from target ${TARGET} dB`, report);
  return report;
}

// ---------------------------------------------------------------- exports

export const commands = {
  generate,
  cues: cuesCommand,
  import: importCommand,
  swap: importCommand,
  mix: mixCommand,
  check: checkCommand,
};
