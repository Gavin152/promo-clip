// Core math / timing helpers shared by visuals and audio.
// Output format + size come from the page URL: index.html?format=vertical|square&size=4K|1080x1350
// (defaults: landscape, 1080p). Scenes draw in design units W x H; main.js scales them to the
// OUT_W x OUT_H canvas. Vertical and square share one design width (1260).
import { resolveSize, LAYOUT_KEY } from './formats.js';

const q = typeof location !== 'undefined' ? new URLSearchParams(location.search) : null;
const RES = resolveSize(q?.get('format') || 'landscape', q?.get('size') || '1080p');
export const FMT = RES.format;
/** layout key of the current format: 'land' | 'vert' | 'sq' */
export const LKEY = LAYOUT_KEY[FMT];
export const W = RES.designW;
export const H = RES.designH;
export const OUT_W = RES.outW;
export const OUT_H = RES.outH;
export const SCALE = RES.scale;
export const CROP_X = RES.cropX;
export const CROP_Y = RES.cropY;
/** per-format value: pick(landscape, vertical, square = vertical) */
export const pick = (l, v, s = v) => (FMT === 'vertical' ? v : FMT === 'square' ? s : l);
export { DURATION } from './data.js';

export const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const lerp = (a, b, t) => a + (b - a) * t;
/** 0..1 progress of t between a and b */
export const prog = (t, a, b) => clamp((t - a) / (b - a));
export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

// Easings
export const ease = {
  linear: (x) => x,
  inQuad: (x) => x * x,
  outQuad: (x) => 1 - (1 - x) * (1 - x),
  inOutQuad: (x) => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2),
  inCubic: (x) => x * x * x,
  outCubic: (x) => 1 - Math.pow(1 - x, 3),
  inOutCubic: (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2),
  outQuart: (x) => 1 - Math.pow(1 - x, 4),
  inOutSine: (x) => -(Math.cos(Math.PI * x) - 1) / 2,
  outBack: (x, s = 1.70158) => (x <= 0 ? 0 : 1 + (s + 1) * Math.pow(x - 1, 3) + s * Math.pow(x - 1, 2)), // exact 0 at the start (not 1e-16), so 'k > 0' gates hold
  inBack: (x, s = 1.70158) => (s + 1) * x * x * x - s * x * x,
  outElastic: (x) => {
    if (x === 0 || x === 1) return x;
    return Math.pow(2, -10 * x) * Math.sin((x * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1;
  },
};

/** deterministic hash -> [0,1) */
export function hash(...n) {
  let h = 2166136261;
  for (const v of n) {
    const x = Math.floor(v * 1000) | 0;
    h ^= x;
    h = Math.imul(h, 16777619);
    h ^= h >>> 13;
    h = Math.imul(h, 0x5bd1e995);
    h ^= h >>> 15;
  }
  return (h >>> 0) / 4294967296;
}
/** deterministic hash -> [-1,1) */
export const hs = (...n) => hash(...n) * 2 - 1;

export function rng(seed) {
  let a = (seed * 2654435761) >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** smooth 1D value noise in [-1,1] */
export function noise1(x) {
  const i = Math.floor(x);
  const f = x - i;
  const a = hs(i, 17.3);
  const b = hs(i + 1, 17.3);
  const u = f * f * (3 - 2 * f);
  return a + (b - a) * u;
}

/** pop-in scale: 0 before t0, overshoot to 1 */
export function pop(t, t0, dur = 0.45, s = 2.2) {
  const p = prog(t, t0, t0 + dur);
  return p <= 0 ? 0 : ease.outBack(p, s);
}
/** pop-out: 1 until t0 then shrink to 0 */
export function unpop(t, t0, dur = 0.3) {
  const p = prog(t, t0, t0 + dur);
  return 1 - ease.inBack(p, 2);
}
/** fade in/out envelope */
export function env(t, a, b, fin = 0.3, fout = 0.3) {
  return Math.min(prog(t, a, a + fin), 1 - prog(t, b - fout, b));
}
/** decaying camera shake offset */
export function shake(t, t0, dur = 0.5, amp = 14) {
  const p = prog(t, t0, t0 + dur);
  if (p <= 0 || p >= 1) return [0, 0, 0];
  const k = amp * Math.pow(1 - p, 2);
  const x = (t - t0) * 60;
  return [noise1(x) * k, noise1(x + 50) * k, noise1(x + 99) * k * 0.002];
}

/** draws fn with primary-format coords mapped by g = [dx, dy, s] (x' = dx + s*x); g = null draws as is */
export function grp(ctx, g, fn) {
  if (!g) return fn();
  ctx.save();
  ctx.translate(g[0], g[1]);
  ctx.scale(g[2], g[2]);
  fn();
  ctx.restore();
}
