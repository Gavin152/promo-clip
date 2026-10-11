// Pure DSP for music analysis: onset detection, BPM, beat grid, downbeats, hits, bar profile.
// No ffmpeg / no file I/O — importable in unit tests without any native deps.

export const SR = 22050; // analysis sample rate
export const N = 2048; // FFT size
export const HOP = 256; // hop size
export const FPS = SR / HOP; // frames per second

// ---------------------------------------------------------------- FFT (Cooley–Tukey, in-place)
export function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const a = (-2 * Math.PI) / len, wr = Math.cos(a), wi = Math.sin(a);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k], ui = im[i + k];
        const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ur + vr; im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
}

// ---------------------------------------------------------------- signal analysis
/** analyse a Float32Array (mono, at SR Hz) and return the envelopes needed by the other functions */
export function analyseSignal(x) {
  const win = Float32Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N));
  const nF = Math.floor((x.length - N) / HOP);
  const bins = N / 2, hz = SR / N;
  const bandEdges = [[20, 60], [60, 250], [250, 2000], [2000, 5000], [5000, 11000]];
  const bandE = bandEdges.map(() => 0);
  let prev = new Float32Array(bins), prevLow = 0;
  const flux = new Float32Array(nF), low = new Float32Array(nF), rms = new Float32Array(nF);
  const re = new Float32Array(N), im = new Float32Array(N);
  for (let f = 0; f < nF; f++) {
    let s = 0;
    for (let i = 0; i < N; i++) {
      const v = x[f * HOP + i]; re[i] = v * win[i]; im[i] = 0;
      if (i >= N / 2 - HOP / 2 && i < N / 2 + HOP / 2) s += v * v;
    }
    rms[f] = 10 * Math.log10(s / HOP + 1e-12);
    fft(re, im);
    let fl = 0, lowE = 0;
    const cur = new Float32Array(bins);
    for (let k = 1; k < bins; k++) {
      const p = re[k] * re[k] + im[k] * im[k];
      cur[k] = Math.log1p(1000 * Math.sqrt(p));
      const d = cur[k] - prev[k];
      if (d > 0) fl += d;
      const fr = k * hz;
      if (fr < 150) lowE += p;
      for (let b = 0; b < bandEdges.length; b++) if (fr >= bandEdges[b][0] && fr < bandEdges[b][1]) bandE[b] += p;
    }
    const lowL = Math.log1p(lowE);
    low[f] = Math.max(0, lowL - prevLow);
    prevLow = lowL;
    flux[f] = fl;
    prev = cur;
  }
  // subtract local mean from onset envelope
  const on = new Float32Array(nF);
  const W = Math.round(FPS * 0.5);
  for (let f = 0; f < nF; f++) {
    let m = 0, c = 0;
    for (let k = Math.max(0, f - W); k < Math.min(nF, f + W); k++) { m += flux[k]; c++; }
    on[f] = Math.max(0, flux[f] - m / c);
  }
  const tot = bandE.reduce((a, b) => a + b, 0) || 1;
  const bands = Object.fromEntries(bandEdges.map(([a, b], i) => [`${a}-${b}Hz`, +(10 * Math.log10(bandE[i] / tot)).toFixed(1)]));
  return { on, low, rms, nF, bands };
}

// ---------------------------------------------------------------- tempo
/** linear interpolation into an array */
export const interp = (a, i) => { const k = Math.floor(i), u = i - k; return k + 1 < a.length ? a[k] * (1 - u) + a[k + 1] * u : 0; };

/** autocorrelation-based BPM detection (70–180 BPM, onset envelope) */
export function tempo(on, nF) {
  let best = 0, bestS = -1;
  for (let bpm = 70; bpm <= 180; bpm += 0.1) {
    const lag = (60 / bpm) * FPS;
    let s = 0, c = 0;
    for (let f = 0; f + lag * 2 < nF; f++) {
      s += on[f] * (interp(on, f + lag) + 0.5 * interp(on, f + 2 * lag) + 0.25 * interp(on, f + lag / 2));
      c++;
    }
    const prior = Math.exp(-0.5 * Math.pow(Math.log2(bpm / 105) / 0.9, 2));
    const sc = (s / c) * prior;
    if (sc > bestS) { bestS = sc; best = bpm; }
  }
  return +best.toFixed(2);
}

// ---------------------------------------------------------------- beat grid
/**
 * refine period + phase with a comb filter; snap each beat to the nearest onset.
 * low (optional): low-band onset envelope. The phase comb weighs it over the broadband flux
 * (x2, both mean-normalised), so the grid locks onto kick/bass rather than off-beat hi-hats.
 */
export function beatGrid(on, nF, bpm, low = null) {
  let env = on;
  if (low) {
    // mean-normalised so neither envelope dominates by scale; low weighted x2 because beats sit on
    // kick/bass, while hi-hats (sharp, broadband) often sit on the off-beat
    const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length || 1;
    const mo = mean(on), ml = mean(low);
    env = Float32Array.from(on, (v, i) => v / mo + (2 * (low[i] ?? 0)) / ml);
  }
  let best = { s: -1 };
  for (let b = bpm * 0.985; b <= bpm * 1.015; b += 0.02) {
    const P = (60 / b) * FPS;
    for (let ph = 0; ph < P; ph += 0.25) {
      let s = 0;
      for (let f = ph; f < nF; f += P) s += interp(env, f);
      if (s > best.s) best = { s, P, ph, bpm: b };
    }
  }
  const beats = [];
  const R = Math.round(0.035 * FPS);
  const maxOn = Math.max(...on);
  for (let f = best.ph; f < nF; f += best.P) {
    let bf = Math.round(f), bv = -1;
    for (let k = Math.max(0, Math.round(f) - R); k <= Math.min(nF - 1, Math.round(f) + R); k++) if (on[k] > bv) { bv = on[k]; bf = k; }
    beats.push({ t: (bv > 0.15 * Math.max(...on.slice(Math.max(0, bf - 40), bf + 40), maxOn * 0.01) ? bf : f) / FPS + (N / 2) / SR, s: bv });
  }
  return { bpm: +best.bpm.toFixed(2), period: best.P / FPS, beats };
}

// ---------------------------------------------------------------- downbeats
/** identify the phase of the bar grid (which beat is beat 1) */
export function downbeats(beats, low, on) {
  const frameOf = (t) => Math.round((t - (N / 2) / SR) * FPS);
  const acc = [0, 0, 0, 0];
  beats.forEach((b, i) => {
    const f = frameOf(b.t);
    let m = 0;
    for (let k = f - 2; k <= f + 2; k++) m = Math.max(m, (low[k] ?? 0) * 2 + (on[k] ?? 0) * 0.05);
    acc[i % 4] += m;
  });
  const off = acc.indexOf(Math.max(...acc));
  return { offset: off, downbeats: beats.filter((_, i) => i % 4 === off).map((b) => +b.t.toFixed(3)) };
}

// ---------------------------------------------------------------- story hits
/**
 * Detect the reveal, final (button), and end hit times from the onset/RMS/loudness envelopes.
 * beatTimes is an array of numbers (track seconds), dbs is the downbeat array (track seconds).
 */
export function hits(rms, on, nF, dur, beatTimes, dbs) {
  const lin = Array.from(rms, (d) => Math.pow(10, d / 10));
  const meanDb = (a, b) => {
    a = Math.max(0, Math.round(a * FPS)); b = Math.min(nF, Math.round(b * FPS));
    let s = 0; for (let k = a; k < b; k++) s += lin[k];
    return 10 * Math.log10(s / Math.max(1, b - a) + 1e-12);
  };
  const nearest = (arr, t) => arr.length ? arr.reduce((p, c) => (Math.abs(c - t) < Math.abs(p - t) ? c : p), arr[0]) : t;

  // reveal: largest loudness lift near the 20–50% mark, on a downbeat
  let reveal = null, rv = -99;
  for (const t of dbs) {
    if (t < dur * 0.18 || t > dur * 0.5) continue;
    const lift = meanDb(t, t + 4) - meanDb(t - 2.4, t - 0.05);
    if (lift > rv) { rv = lift; reveal = t; }
  }
  // fallback: median downbeat
  if (reveal == null) reveal = dbs.length ? dbs[Math.floor(dbs.length / 4)] : 0;

  // end: last moment above (peak - 40 dB)
  const peakDb = Math.max(...Array.from({ length: Math.floor(dur / 0.4) }, (_, i) => meanDb(i * 0.4, i * 0.4 + 0.4)).filter(Number.isFinite));
  let end = dur;
  for (let t = dur - 0.2; t > 0; t -= 0.05) if (meanDb(t, t + 0.2) > peakDb - 40) { end = +t.toFixed(2); break; }

  // final hit: beat in the last 30% with strongest onset + ring-out decay
  let fin = null, fv = -1;
  for (const t of beatTimes) {
    if (t < end - 12 || t > end - 1.2) continue;
    const f = Math.round(t * FPS);
    let o = 0; for (let k = f - 3; k <= f + 3; k++) o = Math.max(o, on[k] ?? 0);
    const decay = meanDb(t - 1.2, t) - meanDb(t + 1.5, Math.min(end, t + 4));
    const after = meanDb(t, t + 0.6) - meanDb(t - 0.6, t);
    const sc = o * (1 + Math.max(0, decay) / 6) * (1 + Math.max(0, after) / 6);
    if (sc > fv) { fv = sc; fin = t; }
  }
  // fallback: last beat before end
  if (fin == null) fin = beatTimes.length ? beatTimes.filter((t) => t < end - 0.5).at(-1) ?? beatTimes.at(-1) : 0;
  // the button is placed on its attack, not on the grid: snap to the strongest onset within ±0.3 s
  {
    const f0 = Math.round((fin - (N / 2) / SR) * FPS), R = Math.round(0.3 * FPS);
    let bf = f0, bv = -1;
    for (let k = Math.max(0, f0 - R); k <= Math.min(nF - 1, f0 + R); k++) if ((on[k] ?? 0) > bv) { bv = on[k]; bf = k; }
    if (bv > 0) fin = bf / FPS + (N / 2) / SR;
  }

  return { reveal: +reveal.toFixed(3), revealLiftDb: +rv.toFixed(1), final: +fin.toFixed(3), end, snapFinalDownbeat: nearest(dbs, fin) };
}

// ---------------------------------------------------------------- bar profile
/** per-bar RMS + high-frequency energy for section-accent detection */
export function barProfile(x, dbs, period) {
  const bar = period * 4, out = [];
  for (const t of dbs) {
    const a = Math.round(t * SR), b = Math.min(x.length, Math.round((t + bar) * SR));
    if (b - a < SR * 0.5) continue;
    let s = 0, sh = 0, prev = x[a];
    for (let i = a; i < b; i++) { s += x[i] * x[i]; const h = x[i] - prev; prev = x[i]; sh += h * h; }
    out.push({ t, rms: 10 * Math.log10(s / (b - a) + 1e-12), high: 10 * Math.log10(sh / (b - a) + 1e-12) });
  }
  return out;
}

/** dB lift entering bar i (relative to bar i-1): used for accent detection */
export const liftAt = (bars, i) => (i <= 0 || i >= bars.length ? 0 : (bars[i].rms - bars[i - 1].rms) + 0.5 * (bars[i].high - bars[i - 1].high));
