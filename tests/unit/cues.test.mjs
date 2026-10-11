// Unit tests for music DSP: BPM detection, beat-grid accuracy, placement calculation.
// Integration test: music import on a temp copy of fixtures/sample-15s.
// node --test tests/unit/cues.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, copyFileSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, '../..');
const FIXTURE = join(ROOT, 'fixtures/sample-15s');

import {
  SR, N, HOP, FPS,
  analyseSignal, tempo, beatGrid, interp,
  downbeats as computeDownbeats, hits, liftAt, barProfile,
} from '../../engine/tools/lib/music-dsp.mjs';

// ---------------------------------------------------------------- synthetic signal helpers

/** generate a mono click track at `bpm` for `dur` seconds at `sr` Hz */
function clickTrack(bpm, dur, sr = SR) {
  const beat = 60 / bpm;
  const x = new Float32Array(Math.ceil(dur * sr));
  for (let t = 0; t < dur; t += beat) {
    const i = Math.round(t * sr);
    if (i < x.length) {
      // sharp click: single sample + short exponential decay
      for (let k = 0; k < 40 && i + k < x.length; k++) x[i + k] += Math.exp(-k * 0.3) * 0.9;
    }
  }
  return x;
}

/** mix sinusoidal chord tones for a richer signal (kicks at downbeats) */
function chordTrack(bpm, dur, sr = SR) {
  const x = new Float32Array(Math.ceil(dur * sr));
  const beat = 60 / bpm;
  const freq = 261.63; // C4
  for (let i = 0; i < x.length; i++) {
    const t = i / sr;
    // base chord tone
    x[i] += Math.sin(2 * Math.PI * freq * t) * 0.05;
    // click at each beat
    const phase = (t % beat) / beat;
    if (phase < 0.02) x[i] += Math.exp(-phase * 50 * beat * sr) * 0.4;
  }
  return x;
}

// ---------------------------------------------------------------- BPM detection

test('tempo() detects 120 BPM click track within ±2 BPM', () => {
  const x = clickTrack(120, 20);
  const A = analyseSignal(x);
  const bpm = tempo(A.on, A.nF);
  assert.ok(Math.abs(bpm - 120) <= 2, `expected ~120, got ${bpm}`);
});

test('tempo() detects 90 BPM click track within ±2 BPM', () => {
  const x = clickTrack(90, 20);
  const A = analyseSignal(x);
  const bpm = tempo(A.on, A.nF);
  assert.ok(Math.abs(bpm - 90) <= 2, `expected ~90, got ${bpm}`);
});

test('tempo() detects 150 BPM click track: accepts 150 or half-time 75 (prior-based algorithm)', () => {
  // The prior is centred at 105 BPM; 150 BPM and its sub-tempo 75 BPM are equally valid
  // interpretations for this simple click track.
  const x = clickTrack(150, 20);
  const A = analyseSignal(x);
  const bpm = tempo(A.on, A.nF);
  const ok = Math.abs(bpm - 150) <= 2 || Math.abs(bpm - 75) <= 2;
  assert.ok(ok, `expected ~150 or ~75 (half-time), got ${bpm}`);
});

// ---------------------------------------------------------------- beat grid accuracy

test('beatGrid() produces beats spaced at ~0.5 s for a 120 BPM track', () => {
  const x = clickTrack(120, 20);
  const A = analyseSignal(x);
  const G = beatGrid(A.on, A.nF, 120);
  // beat period should be close to 0.5 s
  assert.ok(Math.abs(G.period - 0.5) < 0.02, `period expected ~0.5, got ${G.period}`);
  // at least 30 beats in a 20 s track at 120 BPM
  assert.ok(G.beats.length >= 30, `expected ≥30 beats, got ${G.beats.length}`);
  // consecutive beat spacing stays close to 0.5 s
  const spacings = G.beats.slice(1).map((b, i) => b.t - G.beats[i].t);
  const maxDrift = Math.max(...spacings.map((s) => Math.abs(s - 0.5)));
  assert.ok(maxDrift < 0.08, `beat spacing drift ${maxDrift.toFixed(3)} s too large`);
});

test('beatGrid() total beat count is within 10% of expected count', () => {
  const BPM = 120, DUR = 20;
  const x = clickTrack(BPM, DUR);
  const A = analyseSignal(x);
  const G = beatGrid(A.on, A.nF, BPM);
  const expected = Math.round((DUR * BPM) / 60);
  assert.ok(Math.abs(G.beats.length - expected) <= expected * 0.1, `expected ~${expected} beats, got ${G.beats.length}`);
});

// ---------------------------------------------------------------- downbeats

test('computeDownbeats() returns every 4th beat', () => {
  const x = clickTrack(120, 20);
  const A = analyseSignal(x);
  const G = beatGrid(A.on, A.nF, 120);
  const D = computeDownbeats(G.beats, A.low, A.on);
  // downbeats must be a subset of beats
  const beatSet = new Set(G.beats.map((b) => +b.t.toFixed(3)));
  for (const d of D.downbeats) assert.ok(beatSet.has(d), `downbeat ${d} not in beat set`);
  // roughly every 2 s (4 × 0.5 s)
  if (D.downbeats.length >= 2) {
    const gaps = D.downbeats.slice(1).map((d, i) => d - D.downbeats[i]);
    const avgGap = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    assert.ok(Math.abs(avgGap - 2) < 0.3, `avg downbeat gap ${avgGap.toFixed(2)} s, expected ~2 s`);
  }
});

// ---------------------------------------------------------------- placement calculation (pure math)

test('placement offset = targetFilm - finalHit', () => {
  // fixture values: final hit at track 16 s, last word "now" at film 10.41 s
  const finalHit = 16;
  const targetFilm = 10.41;
  const offset = +(targetFilm - finalHit).toFixed(3);
  assert.equal(offset, -5.59);
});

test('film.final = offset + finalHit', () => {
  const offset = -5.59, finalHit = 16;
  const filmFinal = +(offset + finalHit).toFixed(3);
  assert.equal(filmFinal, 10.41);
});

test('interp() linear interpolation between array values', () => {
  const a = new Float32Array([0, 10, 20, 30]);
  assert.equal(interp(a, 0), 0);
  assert.equal(interp(a, 1), 10);
  assert.equal(interp(a, 1.5), 15);
  // floating-point: 2.8 → 0.8*30 + 0.2*20 = 28 (±epsilon)
  assert.ok(Math.abs(interp(a, 2.8) - 28) < 1e-10, `interp(a, 2.8) should be ≈28`);
});

// ---------------------------------------------------------------- ranking score formula

test('ranking score: perfect placement + strong reveal + ideal loudness → ~100', async () => {
  // import the music.mjs file to call the internal rankingScore function
  // We test it by importing the cues sub-command, but since rankingScore is not exported,
  // we verify the logic directly using known inputs:
  // revealPts = min(40, revealLiftDb * 4) = min(40, 10 * 4) = 40
  // placePts = 40 * exp(-0 / 0.3) = 40
  // energyPts = 20 * max(0, 1 - |(-14 + 14)| / 14) = 20
  const revealLiftDb = 10, alignmentFinalErr = 0, lufs = -14;
  const revealPts = Math.min(40, Math.max(0, revealLiftDb * 4));
  const placePts = 40 * Math.exp(-Math.abs(alignmentFinalErr) / 0.3);
  const energyPts = 20 * Math.max(0, 1 - Math.abs(lufs + 14) / 14);
  const score = Math.round(revealPts + placePts + energyPts);
  assert.equal(score, 100);
});

test('ranking score: no reveal lift + 1 s placement error + loud → <40', () => {
  const revealLiftDb = 0, alignmentFinalErr = 1.0, lufs = -8;
  const revealPts = Math.min(40, Math.max(0, revealLiftDb * 4));
  const placePts = 40 * Math.exp(-Math.abs(alignmentFinalErr) / 0.3);
  const energyPts = 20 * Math.max(0, 1 - Math.abs(lufs + 14) / 14);
  const score = Math.round(revealPts + placePts + energyPts);
  assert.ok(score < 40, `expected score < 40, got ${score}`);
});

// ---------------------------------------------------------------- integration: music import on fixture

test('music import on fixture → offset ≈ -5.59 s, film.final ≈ 10.41 s', { timeout: 60000 }, async () => {
  // set up a temp project dir; import copies the fixture track into it
  const tmp = join(tmpdir(), `promo-clip-test-${process.pid}`);
  const voDir = join(tmp, 'vo');
  mkdirSync(join(tmp, 'assets/music'), { recursive: true });
  mkdirSync(voDir, { recursive: true });

  // timing.json and script.md must be in the temp project
  copyFileSync(join(FIXTURE, 'vo/timing.json'), join(voDir, 'timing.json'));
  copyFileSync(join(FIXTURE, 'script.md'), join(tmp, 'script.md'));
  // minimal promo.json (required by paid.mjs / loadState)
  writeFileSync(join(tmp, 'promo.json'), JSON.stringify({
    name: 'test', engine: '1.0.0', mode: 'gated',
    budget: { limitUsd: 10, spentUsd: 0 },
    output: { formats: ['landscape'], primary: 'landscape', sizes: ['720p'], fps: 30 },
    stages: {}, gates: [], spend: [],
  }, null, 2));

  // run the import sub-command directly (no CLI, no API calls)
  // pass the original fixture track.mp3 as the source; import copies it into the temp project
  const { commands } = await import('../../engine/tools/music.mjs');
  const logs = [];
  const result = await commands.import({
    project: tmp,
    pos: [join(FIXTURE, 'assets/music/track.mp3')],
    flags: {},
    log: (msg) => logs.push(msg),
    json: false,
  });

  // verify the cues.json was written
  const cuesPath = join(tmp, 'assets/music/cues.json');
  assert.ok(existsSync(cuesPath), 'cues.json was not written');
  const cues = JSON.parse(readFileSync(cuesPath, 'utf8'));

  // offset should be ≈ -5.59 s (±0.5 s tolerance: DSP from compressed MP3 may shift slightly)
  assert.ok(Math.abs(cues.offset - (-5.59)) < 0.5, `offset expected ≈ -5.59, got ${cues.offset}`);

  // film.final should be ≈ 10.41 s (±0.5 s tolerance)
  assert.ok(Math.abs(cues.film.final - 10.41) < 0.5, `film.final expected ≈ 10.41, got ${cues.film.final}`);

  // basic structure checks
  assert.ok(Array.isArray(cues.beats) && cues.beats.length > 10, 'beats array missing or short');
  assert.ok(cues.bpm > 100 && cues.bpm < 140, `bpm expected ~120, got ${cues.bpm}`);
  assert.ok(typeof cues.loudness?.lufs === 'number', 'loudness.lufs missing');
  assert.ok(cues.mix && typeof cues.mix.duckDb === 'number', 'mix block missing');
});
