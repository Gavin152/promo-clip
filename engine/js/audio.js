// Soundtrack engine: single-take voice-over + one music file (assets/music/track.*) + procedural SFX.
// The music is placed and ducked from data only: assets/music/cues.json (offset, mix profile) and
// vo/timing.json (word times -> smooth sidechain-style ducking). Swapping the music needs no code
// changes. The same graph renders live (AudioContext) or offline (OfflineAudioContext) for export.
// SFX come from the scenes: each scene's sfx(T) returns cues like { t, kind: 'whoosh', vel }; main.js
// collects them (plus the transition sounds) and hands the list to the AudioEngine.
import { DURATION, rng } from './util.js';
import { TIMING, CUES, VO_START, MOFF } from './data.js';
import { VO_B64, MUSIC_B64 } from '@build/media-data.js';

const SR = 48000;
const db = (x) => Math.pow(10, x / 20);
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

// ---------------------------------------------------------------- ducking curve
const CURVE_RATE = 100; // Hz
/** music gain (linear) over the whole film, sampled at CURVE_RATE */
export function musicGainCurve(mix = CUES.mix) {
  const n = Math.ceil(DURATION * CURVE_RATE) + 1;
  // 1) speech regions from word times; short gaps stay ducked (no pumping between words)
  const regions = [];
  for (const w of TIMING.words) {
    const a = VO_START + w.start, b = VO_START + w.end;
    const last = regions[regions.length - 1];
    if (last && a - last[1] < mix.mergeGap) last[1] = b;
    else regions.push([a, b]);
  }
  // 2) target level (dB): duck while speaking (pulled forward by lookahead), bed otherwise
  const target = new Float32Array(n).fill(mix.bedDb);
  for (const [a, b] of regions) {
    const i0 = Math.max(0, Math.floor((a - mix.lookahead) * CURVE_RATE)), i1 = Math.min(n, Math.ceil(b * CURVE_RATE));
    for (let i = i0; i < i1; i++) target[i] = mix.duckDb;
  }
  for (const s of mix.sections ?? []) for (let i = Math.floor(s.from * CURVE_RATE); i < Math.min(n, s.to * CURVE_RATE); i++) target[i] += s.db;
  // 3) smoothing: forward pass = release (level may drop instantly, rises with the release
  //    time-constant); backward pass = attack (the dip starts early, so the duck is already
  //    complete when the first word lands). Result: a smooth sidechain-style envelope.
  const ka = 1 - Math.exp(-1 / (mix.attack * CURVE_RATE)), kr = 1 - Math.exp(-1 / (mix.release * CURVE_RATE));
  const rel = new Float32Array(n);
  rel[0] = target[0];
  for (let i = 1; i < n; i++) rel[i] = target[i] <= rel[i - 1] ? target[i] : rel[i - 1] + (target[i] - rel[i - 1]) * kr;
  const out = new Float32Array(n);
  out[n - 1] = rel[n - 1];
  for (let i = n - 2; i >= 0; i--) out[i] = rel[i] > out[i + 1] ? out[i + 1] + (rel[i] - out[i + 1]) * ka : rel[i];
  // 4) dB -> linear, fades
  for (let i = 0; i < n; i++) {
    const t = i / CURVE_RATE;
    let g = db(out[i]);
    if (t < mix.fadeIn) g *= t / mix.fadeIn;
    if (t > DURATION - mix.fadeOut) g *= Math.max(0, (DURATION - t) / mix.fadeOut);
    out[i] = g;
  }
  return out;
}

// ---------------------------------------------------------------- helpers
function noiseBuffer(sec, kind = 'white', seed = 1) {
  const N = Math.floor(SR * sec);
  const buf = new AudioBuffer({ length: N, sampleRate: SR, numberOfChannels: 2 });
  for (let ch = 0; ch < 2; ch++) {
    const r = rng(seed + ch * 77);
    const d = new Float32Array(N);
    let b = 0;
    for (let i = 0; i < N; i++) {
      const w = r() * 2 - 1;
      if (kind === 'brown') { b = (b + 0.02 * w) / 1.02; d[i] = b * 3.5; } else d[i] = w;
    }
    buf.copyToChannel(d, ch);
  }
  return buf;
}
function impulse(sec = 2.2, decay = 3.2) {
  const N = Math.floor(SR * sec);
  const buf = new AudioBuffer({ length: N, sampleRate: SR, numberOfChannels: 2 });
  for (let ch = 0; ch < 2; ch++) {
    const r = rng(900 + ch);
    const d = new Float32Array(N);
    for (let i = 0; i < N; i++) d[i] = (r() * 2 - 1) * Math.pow(1 - i / N, decay) * (i < SR * 0.012 ? i / (SR * 0.012) : 1);
    buf.copyToChannel(d, ch);
  }
  return buf;
}
function b64ToArrayBuffer(b64) {
  const bin = atob(b64);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u.buffer;
}

// ---------------------------------------------------------------- engine
export class AudioEngine {
  /** cues: [{ t, kind, ...params }] (see SFX below) */
  constructor(cues = []) { this.ctx = null; this.playing = null; this.curve = musicGainCurve(); this.cues = cues; }
  async load() {
    const dec = new OfflineAudioContext(2, 1, SR);
    [this.voBuf, this.musicBuf] = await Promise.all([dec.decodeAudioData(b64ToArrayBuffer(VO_B64)), dec.decodeAudioData(b64ToArrayBuffer(MUSIC_B64))]);
    this.smp = { white: noiseBuffer(2.5, 'white', 3), brown: noiseBuffer(6, 'brown', 5), ir: impulse() };
  }
  play(offset) {
    if (!this.ctx) this.ctx = new AudioContext({ sampleRate: SR, latencyHint: 'playback' });
    this.stop();
    this.ctx.resume();
    const t0 = this.ctx.currentTime + 0.06;
    this.t0 = t0;
    this.offset = offset;
    this.playing = buildGraph(this.ctx, this.ctx.destination);
    schedule(this.ctx, this.playing, t0, offset, this);
  }
  time() {
    if (!this.ctx) return this.offset || 0;
    return Math.max(this.offset, this.offset + (this.ctx.currentTime - this.t0) - (this.ctx.outputLatency || 0));
  }
  stop() {
    if (!this.playing) return;
    const g = this.playing.master, now = this.ctx.currentTime;
    g.gain.cancelScheduledValues(now);
    g.gain.setTargetAtTime(0, now, 0.015);
    const old = this.playing;
    setTimeout(() => old.out.disconnect(), 150);
    this.playing = null;
  }
  /** solo: 'vo' | 'music' | 'sfx' | 'musicRaw' (music without ducking) | undefined (full mix) */
  async renderOffline(solo) {
    const oc = new OfflineAudioContext(2, Math.ceil(DURATION * SR), SR);
    const g = buildGraph(oc, oc.destination, solo);
    if (solo) for (const k of ['music', 'sfx', 'vo']) if (!solo.startsWith(k)) g[k].gain.value = 0;
    schedule(oc, g, 0, 0, this, solo === 'musicRaw');
    return oc.startRendering();
  }
  toWavBase64(buf) {
    const n = buf.length;
    const out = new DataView(new ArrayBuffer(44 + n * 4));
    const ws = (o, s) => [...s].forEach((c, i) => out.setUint8(o + i, c.charCodeAt(0)));
    ws(0, 'RIFF'); out.setUint32(4, 36 + n * 4, true); ws(8, 'WAVE'); ws(12, 'fmt ');
    out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, 2, true);
    out.setUint32(24, SR, true); out.setUint32(28, SR * 4, true); out.setUint16(32, 4, true); out.setUint16(34, 16, true);
    ws(36, 'data'); out.setUint32(40, n * 4, true);
    const L = buf.getChannelData(0), R = buf.getChannelData(1);
    let o = 44;
    for (let i = 0; i < n; i++) {
      out.setInt16(o, Math.max(-1, Math.min(1, L[i])) * 32767, true);
      out.setInt16(o + 2, Math.max(-1, Math.min(1, R[i])) * 32767, true);
      o += 4;
    }
    const bytes = new Uint8Array(out.buffer);
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }
}

function buildGraph(ctx, dest, solo) {
  const out = ctx.createGain();
  const master = ctx.createGain();
  // gentle bus glue + safety limiter (the export normalises loudness afterwards)
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -18; comp.knee.value = 10; comp.ratio.value = 2; comp.attack.value = 0.01; comp.release.value = 0.25;
  const lim = ctx.createDynamicsCompressor();
  lim.threshold.value = -3; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = 0.001; lim.release.value = 0.08;
  if (solo) master.connect(out); else master.connect(comp).connect(lim).connect(out);
  out.connect(dest);
  master.gain.value = 1;
  // music: file -> duck envelope -> master (no EQ: the cue is already mixed)
  const music = ctx.createGain();
  const duck = ctx.createGain();
  music.connect(duck).connect(master);
  // voice: gentle high-pass + a touch of presence
  const vo = ctx.createGain();
  const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 80;
  const pres = ctx.createBiquadFilter(); pres.type = 'peaking'; pres.frequency.value = 3000; pres.gain.value = 1.5; pres.Q.value = 0.8;
  vo.connect(hp).connect(pres).connect(master);
  vo.gain.value = db(CUES.mix.voDb ?? 0);
  const sfx = ctx.createGain();
  sfx.gain.value = db(CUES.mix.sfxDb ?? -8);
  sfx.connect(master);
  const verb = ctx.createConvolver();
  const verbOut = ctx.createGain();
  verbOut.gain.value = 0.22;
  verb.connect(verbOut).connect(sfx);
  return { out, master, music, duck, sfx, vo, verb };
}

// ---------------------------------------------------------------- scheduling
function schedule(ctx, G, t0, offset, eng, noDuck = false) {
  const at = (t) => t0 + Math.max(0, t - offset);
  const live = (t) => t >= offset - 0.001;
  const A = { ctx, at, live, G, S: eng.smp, off: offset };
  G.verb.buffer = eng.smp.ir;
  // voice-over (one file)
  const vo = ctx.createBufferSource();
  vo.buffer = eng.voBuf;
  vo.connect(G.vo);
  vo.start(at(Math.max(VO_START, offset)), Math.max(0, offset - VO_START));
  // music (one file) placed at MOFF film seconds
  const m = ctx.createBufferSource();
  m.buffer = eng.musicBuf;
  m.connect(G.music);
  const mStartFilm = Math.max(MOFF, offset);
  m.start(at(mStartFilm), Math.max(0, mStartFilm - MOFF));
  // ducking envelope from the precomputed curve (sliced at the seek point)
  const i0 = Math.floor(offset * CURVE_RATE);
  const curve = noDuck ? null : eng.curve.subarray(i0);
  if (curve && curve.length > 2) G.duck.gain.setValueCurveAtTime(curve, at(offset), (curve.length - 1) / CURVE_RATE);
  for (const c of eng.cues) playCue(A, c);
}

// ---------------------------------------------------------------- SFX primitives (from v1)
// ---------------------------------------------------------------- instruments
function env(g, T, a, peak, hold, rel) {
  g.gain.setValueAtTime(0, T);
  g.gain.linearRampToValueAtTime(peak, T + a);
  g.gain.setTargetAtTime(0, T + a + hold, rel);
}
function pan(A, dest, p) {
  const pn = A.ctx.createStereoPanner();
  pn.pan.value = p;
  pn.connect(dest);
  return pn;
}
function glock(A, t, midi, vel = 0.3, o = {}) {
  if (!A.live(t, 1)) return;
  const T = A.at(t);
  const f = mtof(midi);
  const out = pan(A, o.dest ?? A.G.sfx, o.pan ?? 0.25);
  const partials = [[1, 1, 1.3], [2.76, 0.35, 0.4], [5.4, 0.14, 0.18], [8.93, 0.06, 0.08]];
  const L = o.long ?? 1;
  for (const [r, a, dec] of partials) {
    if (f * r > 18000) continue;
    const osc = A.ctx.createOscillator();
    osc.frequency.value = f * r;
    const g = A.ctx.createGain();
    g.gain.setValueAtTime(0, T);
    g.gain.linearRampToValueAtTime(vel * a * 1.3, T + 0.002);
    g.gain.setTargetAtTime(0, T + 0.004, dec * L * 0.45);
    osc.connect(g).connect(out);
    g.connect(A.G.verb);
    osc.start(T);
    osc.stop(T + dec * L * 3 + 0.1);
  }
}
function noiseHit(A, t, o) {
  if (!A.live(t, o.len ?? 0.3)) return;
  const T = A.at(t);
  const src = A.ctx.createBufferSource();
  src.buffer = o.brown ? A.S.brown : A.S.white;
  const f = A.ctx.createBiquadFilter();
  f.type = o.type ?? 'bandpass';
  f.frequency.setValueAtTime(o.f ?? 2000, T);
  if (o.f2) f.frequency.exponentialRampToValueAtTime(o.f2, T + (o.len ?? 0.3));
  f.Q.value = o.q ?? 1;
  const g = A.ctx.createGain();
  if (o.bursts) {
    g.gain.setValueAtTime(0, T);
    o.bursts.forEach((b) => {
      g.gain.setValueAtTime(o.vel, T + b);
      g.gain.setTargetAtTime(0.0001, T + b + 0.002, 0.006);
    });
    const tail = o.bursts[o.bursts.length - 1];
    g.gain.setValueAtTime(o.vel * 0.8, T + tail + 0.012);
    g.gain.setTargetAtTime(0, T + tail + 0.014, o.decay ?? 0.05);
  } else {
    g.gain.setValueAtTime(0, T);
    g.gain.linearRampToValueAtTime(o.vel, T + (o.attack ?? 0.002));
    g.gain.setTargetAtTime(0, T + (o.attack ?? 0.002) + (o.hold ?? 0), o.decay ?? 0.05);
  }
  let node = src.connect(f).connect(g);
  const out = o.pan != null ? pan(A, o.dest ?? A.G.sfx, o.pan) : o.dest ?? A.G.sfx;
  node.connect(out);
  if (o.verb) g.connect(A.G.verb);
  src.start(T, (o.seed ?? Math.random()) * 1.5);
  src.stop(T + (o.len ?? 0.3) + 1);
}
const crash = (A, t, vel = 0.25, len = 1.6) => noiseHit(A, t, { type: 'highpass', f: 5000, vel, decay: len * 0.35, verb: true, len: len + 0.5, pan: 0.1 });
function riser(A, t0, t1, vel = 0.22, dest) {
  if (!A.live(t1 - 0.05)) return;
  const T0 = A.at(Math.max(t0, 0)), T1 = A.at(t1);
  const src = A.ctx.createBufferSource();
  src.buffer = A.S.white;
  src.loop = true;
  const f = A.ctx.createBiquadFilter();
  f.type = 'bandpass';
  f.Q.value = 1.4;
  f.frequency.setValueAtTime(350, T0);
  f.frequency.exponentialRampToValueAtTime(6000, T1);
  const g = A.ctx.createGain();
  g.gain.setValueAtTime(0.0001, T0);
  g.gain.exponentialRampToValueAtTime(vel, T1 - 0.02);
  g.gain.linearRampToValueAtTime(0, T1);
  src.connect(f).connect(g).connect(dest ?? A.G.music);
  src.start(T0);
  src.stop(T1 + 0.05);
}
// ---------------------------------------------------------------- sound effects
function whoosh(A, t, dur = 0.45, vel = 0.32, o = {}) {
  if (!A.live(t, dur)) return;
  const T = A.at(t);
  const src = A.ctx.createBufferSource();
  src.buffer = A.S.white;
  const f = A.ctx.createBiquadFilter();
  f.type = 'bandpass';
  f.Q.value = 1.1;
  f.frequency.setValueAtTime(o.f0 ?? 300, T);
  f.frequency.exponentialRampToValueAtTime(o.f1 ?? 2600, T + dur * 0.55);
  f.frequency.exponentialRampToValueAtTime(o.f2 ?? 700, T + dur);
  const g = A.ctx.createGain();
  g.gain.setValueAtTime(0.0001, T);
  g.gain.exponentialRampToValueAtTime(vel, T + dur * 0.45);
  g.gain.exponentialRampToValueAtTime(0.0001, T + dur);
  const p = A.ctx.createStereoPanner();
  p.pan.setValueAtTime(o.dir === -1 ? 0.7 : -0.7, T);
  p.pan.linearRampToValueAtTime(o.dir === -1 ? -0.7 : 0.7, T + dur);
  src.connect(f).connect(g).connect(p).connect(A.G.sfx);
  src.start(T, Math.random());
  src.stop(T + dur + 0.05);
}
function popS(A, t, vel = 0.3, pitch = 1) {
  if (!A.live(t)) return;
  const T = A.at(t);
  const o = A.ctx.createOscillator();
  o.frequency.setValueAtTime(380 * pitch, T);
  o.frequency.exponentialRampToValueAtTime(1100 * pitch, T + 0.045);
  const g = A.ctx.createGain();
  g.gain.setValueAtTime(0, T);
  g.gain.linearRampToValueAtTime(vel, T + 0.004);
  g.gain.setTargetAtTime(0, T + 0.03, 0.025);
  o.connect(g).connect(A.G.sfx);
  o.start(T);
  o.stop(T + 0.25);
  noiseHit(A, t, { f: 3000, q: 1, vel: vel * 0.25, decay: 0.008, dest: A.G.sfx, len: 0.05 });
}
function paper(A, t, dur = 0.3, vel = 0.2) {
  const r = rng(Math.floor(t * 1000));
  for (let i = 0; i < 9; i++) noiseHit(A, t + r() * dur, { type: 'highpass', f: 1800 + r() * 2500, vel: vel * (0.4 + r() * 0.6), decay: 0.012 + r() * 0.02, dest: A.G.sfx, len: 0.1, pan: r() - 0.5 });
}
function thud(A, t, vel = 0.7) {
  if (!A.live(t)) return;
  const T = A.at(t);
  const o = A.ctx.createOscillator();
  o.frequency.setValueAtTime(120, T);
  o.frequency.exponentialRampToValueAtTime(40, T + 0.14);
  const g = A.ctx.createGain();
  g.gain.setValueAtTime(vel, T);
  g.gain.setTargetAtTime(0, T + 0.02, 0.09);
  o.connect(g).connect(A.G.sfx);
  o.start(T);
  o.stop(T + 0.5);
  noiseHit(A, t, { type: 'lowpass', f: 900, vel: vel * 0.6, decay: 0.05, dest: A.G.sfx, len: 0.2 });
}
function shutter(A, t, vel = 0.45) {
  noiseHit(A, t, { type: 'highpass', f: 2500, vel, decay: 0.008, dest: A.G.sfx, len: 0.05 });
  noiseHit(A, t + 0.012, { f: 5000, q: 2, vel: vel * 0.4, decay: 0.02, dest: A.G.sfx, len: 0.06 });
  noiseHit(A, t + 0.075, { type: 'highpass', f: 3200, vel: vel * 0.8, decay: 0.01, dest: A.G.sfx, len: 0.05 });
}
function ding(A, t, midi = 88, vel = 0.3) {
  glock(A, t, midi, vel, { dest: A.G.sfx, long: 2, pan: 0 });
}
function arp(A, t, notes, gap = 0.06, vel = 0.2) {
  notes.forEach((m, i) => glock(A, t + i * gap, m, vel, { dest: A.G.sfx, pan: (i / notes.length - 0.5) * 0.8 }));
}
function scribble(A, t, dur = 0.3, vel = 0.12) {
  const r = rng(Math.floor(t * 777));
  const n = Math.max(2, Math.round(dur / 0.07));
  for (let i = 0; i < n; i++) noiseHit(A, t + i * (dur / n), { f: 2800 + r() * 1800, q: 1.8, vel, attack: 0.015, hold: 0.02, decay: 0.02, dest: A.G.sfx, len: 0.1, pan: 0.1 });
}
function buzz(A, t, vel = 0.2) {
  if (!A.live(t, 0.8)) return;
  const T = A.at(t);
  const o = A.ctx.createOscillator();
  o.type = 'square';
  o.frequency.value = 155;
  const lp = A.ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 420;
  const g = A.ctx.createGain();
  g.gain.setValueAtTime(0, T);
  for (let i = 0; i < 2; i++) {
    g.gain.setValueAtTime(vel, T + i * 0.26);
    g.gain.setValueAtTime(0, T + i * 0.26 + 0.18);
  }
  o.connect(lp).connect(g).connect(pan(A, A.G.sfx, 0.5));
  o.start(T);
  o.stop(T + 0.6);
}
function boing(A, t, vel = 0.3) {
  if (!A.live(t, 0.7)) return;
  const T = A.at(t);
  const o = A.ctx.createOscillator();
  o.type = 'triangle';
  o.frequency.setValueAtTime(170, T);
  o.frequency.exponentialRampToValueAtTime(300, T + 0.5);
  const l = A.ctx.createOscillator();
  l.frequency.value = 16;
  const lg = A.ctx.createGain();
  lg.gain.setValueAtTime(70, T);
  lg.gain.exponentialRampToValueAtTime(2, T + 0.6);
  l.connect(lg).connect(o.frequency);
  const g = A.ctx.createGain();
  g.gain.setValueAtTime(vel, T);
  g.gain.setTargetAtTime(0, T + 0.05, 0.16);
  o.connect(g).connect(A.G.sfx);
  o.start(T); l.start(T);
  o.stop(T + 0.9); l.stop(T + 0.9);
}
function gullCry(A, t, vel = 0.07) {
  if (!A.live(t, 0.5)) return;
  [0, 0.3].forEach((d, i) => {
    const T = A.at(t + d);
    const o = A.ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(1150, T);
    o.frequency.linearRampToValueAtTime(1700 - i * 150, T + 0.07);
    o.frequency.exponentialRampToValueAtTime(900, T + 0.26);
    const bp = A.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1600;
    bp.Q.value = 2.5;
    const g = A.ctx.createGain();
    env(g, T, 0.02, vel, 0.12, 0.05);
    o.connect(bp).connect(g).connect(pan(A, A.G.sfx, 0.4));
    o.start(T);
    o.stop(T + 0.5);
  });
}
function waves(A, t0, t1, vel = 0.1) {
  if (!A.live(t1 - 0.2)) return;
  const s0 = Math.max(t0, 0);
  const T0 = A.at(Math.max(s0, 0)), T1 = A.at(t1);
  const src = A.ctx.createBufferSource();
  src.buffer = A.S.brown;
  src.loop = true;
  const lp = A.ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 900;
  const g = A.ctx.createGain();
  g.gain.setValueAtTime(0.0001, T0);
  for (let x = s0, i = 0; x < t1; x += 1.6, i++) {
    if (x + 1.6 < A.off) continue;
    g.gain.linearRampToValueAtTime(vel * (i % 2 ? 0.45 : 1), A.at(Math.min(t1, x + 1.6)));
  }
  g.gain.linearRampToValueAtTime(0, T1);
  src.connect(lp).connect(g).connect(A.G.sfx);
  src.start(T0);
  src.stop(T1 + 0.1);
}
function coins(A, t) {
  const r = rng(42);
  for (let i = 0; i < 7; i++) glock(A, t + r() * 0.22, 96 + Math.floor(r() * 10), 0.08, { dest: A.G.sfx, pan: r() - 0.5 });
  ding(A, t + 0.05, 91, 0.2);
}


// ---------------------------------------------------------------- SFX cue dispatch
/**
 * Every SFX kind a scene can request, with its parameters (all optional except t):
 *   whoosh {dur, vel, dir (1 | -1), f0, f1, f2}   pop {vel, pitch}      paper {dur, vel}
 *   thud {vel}            shutter {vel}           ding {midi, vel}      arp {notes:[midi], gap, vel}
 *   scribble {dur, vel}   buzz {vel}              boing {vel}           gull {vel}
 *   waves {to, vel}       coins {}                crash {vel, len}      riser {to, vel}
 *   glock {midi, vel}     noise {f, f2, q, type, vel, attack, hold, decay, len, pan, verb, brown}
 */
export const SFX = {
  whoosh: (A, c) => whoosh(A, c.t, c.dur ?? 0.45, c.vel ?? 0.32, c),
  pop: (A, c) => popS(A, c.t, c.vel ?? 0.3, c.pitch ?? 1),
  paper: (A, c) => paper(A, c.t, c.dur ?? 0.3, c.vel ?? 0.2),
  thud: (A, c) => thud(A, c.t, c.vel ?? 0.7),
  shutter: (A, c) => shutter(A, c.t, c.vel ?? 0.45),
  ding: (A, c) => ding(A, c.t, c.midi ?? 88, c.vel ?? 0.3),
  arp: (A, c) => arp(A, c.t, c.notes ?? [81, 86, 90], c.gap ?? 0.06, c.vel ?? 0.2),
  scribble: (A, c) => scribble(A, c.t, c.dur ?? 0.3, c.vel ?? 0.12),
  buzz: (A, c) => buzz(A, c.t, c.vel ?? 0.2),
  boing: (A, c) => boing(A, c.t, c.vel ?? 0.3),
  gull: (A, c) => gullCry(A, c.t, c.vel ?? 0.07),
  waves: (A, c) => waves(A, c.t, c.to ?? c.t + 4, c.vel ?? 0.1),
  coins: (A, c) => coins(A, c.t),
  crash: (A, c) => crash(A, c.t, c.vel ?? 0.25, c.len ?? 1.6),
  riser: (A, c) => riser(A, c.t, c.to ?? c.t + 2, c.vel ?? 0.22),
  glock: (A, c) => glock(A, c.t, c.midi ?? 84, c.vel ?? 0.3, { dest: A.G.sfx, pan: c.pan ?? 0.25 }),
  noise: (A, c) => noiseHit(A, c.t, { vel: 0.2, dest: A.G.sfx, ...c }),
};
const warned = new Set();
function playCue(A, c) {
  const fn = SFX[c.kind];
  if (!fn) {
    if (!warned.has(c.kind)) { warned.add(c.kind); console.warn(`unknown sfx kind "${c.kind}" (known: ${Object.keys(SFX).join(', ')})`); }
    return;
  }
  if (!Number.isFinite(c.t)) return;
  fn(A, c);
}
