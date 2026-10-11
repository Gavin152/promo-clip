// Hand-drawn collage primitives: boiling ink lines, marker fills, paper cut-out
// stickers with white borders + soft shadows, torn paper, handwritten text.
// Palette and fonts are the defaults below, overridden by the project's theme.json (palette, fonts)
// at module load, so every module that imports C / FONT already sees the themed values.
import { W, H, OUT_W, OUT_H, TAU, clamp, hs, hash, noise1, rng } from '../../util.js';
import THEME from '@project/theme.json';

/** ink colour (live binding: follows theme.palette.ink) */
export let INK = '#1B1F2A';
export const C = {
  ink: INK,
  navy: '#111827',
  navy2: '#1B2845',
  surface: '#1F2937',
  cyan: '#01D7FC',
  cyanDeep: '#0891B2',
  teal: '#2FA487',
  tealDark: '#1F7A64',
  charcoal: '#2E3338',
  paper: '#F3EBDD',
  kraft: '#D9C3A0',
  cream: '#FFF8EA',
  white: '#FFFFFF',
  sky: '#9ED8EE',
  sky2: '#C9ECF6',
  sea1: '#4FB3D9',
  sea2: '#2E86B8',
  sea3: '#1E5F8F',
  sand: '#EED9A8',
  green: '#8BCB6A',
  sun: '#FFB63B',
  orange: '#FF8A3D',
  coral: '#FF6B6B',
  pink: '#FF6680',
  lime: '#C8F56A',
  red: '#E8413C',
  yellow: '#FFD84D',
  wood: '#B98553',
  woodDark: '#8A5A33',
  skin: '#FFFFFF',
};

export const FONT = {
  marker: '"Permanent Marker", "Comic Sans MS", cursive',
  hand: 'Caveat, "Comic Sans MS", cursive',
  orb: 'Orbitron, "Arial Black", sans-serif',
  inter: 'Inter, Helvetica, Arial, sans-serif',
};

/** the active theme (theme.json); scenes read constants, logo and end-card data from it */
export const THEME_DATA = { palette: {}, fonts: {}, constants: {} };

/** applies a theme: palette + fonts are merged into C / FONT in place (existing imports stay valid) */
export function init(theme = {}) {
  Object.assign(THEME_DATA, theme);
  Object.assign(C, theme.palette ?? {});
  Object.assign(FONT, theme.fonts ?? {});
  INK = C.ink;
}
init(THEME);

/** palette lookup: a palette key ('teal') or any CSS colour ('#2FA487') */
export const col = (x) => C[x] ?? x;

/** global drawing state */
export const S = {
  pass: 'normal', // 'normal' | 'back' (white sticker backing)
  boil: 0, // changes ~8x/sec -> line boil
  border: 11, // sticker border half-width
  t: 0,
  bb: null, // device-space bbox accumulated during the sticker back pass
  // QA hooks (null when idle — zero cost to normal rendering):
  scene: null,   // set by main.js to the current scene id during __frameBoxes
  collect: null, // array filled with {x0,y0,x1,y1,scene} device-px bboxes by sticker(); null = off
};

/** grow sticker bbox by a local point (+pad) under ctx transform */
export function bbAdd(ctx, x, y, pad = 0) {
  if (!S.bb) return;
  const m = ctx.getTransform();
  const k = Math.hypot(m.a, m.b);
  const X = m.a * x + m.c * y + m.e, Y = m.b * x + m.d * y + m.f, P = pad * k;
  const b = S.bb;
  if (X - P < b[0]) b[0] = X - P;
  if (Y - P < b[1]) b[1] = Y - P;
  if (X + P > b[2]) b[2] = X + P;
  if (Y + P > b[3]) b[3] = Y + P;
}

// ---------- point generators ----------
export function resample(pts, step = 18, closed = false) {
  const out = [];
  const n = pts.length;
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const k = Math.max(1, Math.ceil(d / step));
    for (let j = 0; j < k; j++) out.push([a[0] + ((b[0] - a[0]) * j) / k, a[1] + ((b[1] - a[1]) * j) / k]);
  }
  if (!closed) out.push(pts[n - 1]);
  return out;
}
export const line = (x1, y1, x2, y2, step = 18) => resample([[x1, y1], [x2, y2]], step);
export function ell(cx, cy, rx, ry, a0 = 0, a1 = TAU, n) {
  const len = Math.abs(a1 - a0) * Math.max(rx, ry);
  n = n || Math.max(10, Math.ceil(len / 16));
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    pts.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
  }
  if (Math.abs(a1 - a0 - TAU) < 1e-6) pts.pop();
  return pts;
}
export function rrect(x, y, w, h, r = 12) {
  r = Math.min(r, w / 2, h / 2);
  const pts = [];
  const corner = (cx, cy, a0) => {
    for (let i = 0; i <= 4; i++) {
      const a = a0 + (i / 4) * (Math.PI / 2);
      pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
    }
  };
  corner(x + w - r, y + r, -Math.PI / 2);
  corner(x + w - r, y + h - r, 0);
  corner(x + r, y + h - r, Math.PI / 2);
  corner(x + r, y + r, Math.PI);
  return resample(pts, 18, true);
}
export function bez(p0, p1, p2, p3, n = 16) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    pts.push([
      u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
      u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
    ]);
  }
  return pts;
}
export function quad(p0, p1, p2, n = 12) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    pts.push([u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0], u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1]]);
  }
  return pts;
}
/** partial polyline by length fraction */
export function partial(pts, p) {
  if (p >= 1) return pts;
  if (p <= 0) return [pts[0]];
  let total = 0;
  const seg = [];
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    seg.push(d);
    total += d;
  }
  let target = total * p;
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    if (target <= seg[i - 1]) {
      const k = target / seg[i - 1];
      out.push([lerpN(pts[i - 1][0], pts[i][0], k), lerpN(pts[i - 1][1], pts[i][1], k)]);
      return out;
    }
    target -= seg[i - 1];
    out.push(pts[i]);
  }
  return out;
}
const lerpN = (a, b, t) => a + (b - a) * t;
export function polyLen(pts) {
  let l = 0;
  for (let i = 1; i < pts.length; i++) l += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return l;
}

// ---------- jitter / trace ----------
function jitter(pts, amp, seed) {
  if (!amp) return pts;
  const s = seed * 7.31 + S.boil * 3.7;
  return pts.map((p, i) => [p[0] + noise1(i * 0.45 + s) * amp, p[1] + noise1(i * 0.45 + s + 91.7) * amp]);
}
function trace(ctx, pts, closed) {
  const n = pts.length;
  if (n < 2) return;
  ctx.beginPath();
  if (n === 2) {
    ctx.moveTo(pts[0][0], pts[0][1]);
    ctx.lineTo(pts[1][0], pts[1][1]);
    if (closed) ctx.closePath();
    return;
  }
  if (closed) {
    const m0 = mid(pts[n - 1], pts[0]);
    ctx.moveTo(m0[0], m0[1]);
    for (let i = 0; i < n; i++) {
      const m = mid(pts[i], pts[(i + 1) % n]);
      ctx.quadraticCurveTo(pts[i][0], pts[i][1], m[0], m[1]);
    }
    ctx.closePath();
  } else {
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < n - 1; i++) {
      const m = mid(pts[i], pts[i + 1]);
      ctx.quadraticCurveTo(pts[i][0], pts[i][1], m[0], m[1]);
    }
    ctx.lineTo(pts[n - 1][0], pts[n - 1][1]);
  }
}
const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];

/**
 * Draw a hand-drawn shape.
 * o: {fill, stroke, lw, closed, amp, seed, double, hatch, alpha, noBack, cap}
 */
export function shape(ctx, pts, o = {}) {
  const closed = o.closed !== false;
  const amp = o.amp ?? 2.0;
  const seed = o.seed ?? pts.length * 3.1 + (pts[0] ? pts[0][0] * 0.013 + pts[0][1] * 0.007 : 0);
  const lw = o.lw ?? 5;
  const stroke = o.stroke === undefined ? INK : o.stroke;
  ctx.lineJoin = 'round';
  ctx.lineCap = o.cap || 'round';
  if (S.pass === 'back') {
    if (o.noBack) return;
    const jp = jitter(pts, amp * 0.5, seed);
    if (S.bb) {
      const pad = ((stroke ? lw : 0) + S.border * 2) / 2 + 4;
      for (const p of jp) bbAdd(ctx, p[0], p[1], pad);
    }
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#fff';
    trace(ctx, jp, closed);
    if (closed && o.fill) ctx.fill();
    ctx.lineWidth = (stroke ? lw : 0) + S.border * 2;
    ctx.stroke();
    return;
  }
  const a0 = ctx.globalAlpha;
  if (o.alpha != null) ctx.globalAlpha = a0 * o.alpha;
  if (o.fill && closed) {
    const jp = jitter(pts, amp * 0.5, seed);
    trace(ctx, jp, true);
    ctx.fillStyle = o.fill;
    ctx.fill();
    if (o.hatch) hatch(ctx, jp, o.hatch, seed);
  }
  if (stroke && lw > 0) {
    const jp = jitter(pts, amp, seed + 1);
    trace(ctx, jp, closed);
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lw;
    ctx.stroke();
    if (o.double !== false && lw >= 3) {
      const jp2 = jitter(pts, amp * 1.1, seed + 57);
      trace(ctx, jp2, closed);
      ctx.lineWidth = Math.max(1.2, lw * 0.35);
      ctx.globalAlpha = (o.alpha ?? 1) * a0 * 0.55;
      ctx.stroke();
    }
  }
  ctx.globalAlpha = a0;
}

/** marker-style diagonal hatching inside a traced shape */
function hatch(ctx, pts, color, seed) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) {
    x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]);
    x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]);
  }
  ctx.save();
  trace(ctx, pts, true);
  ctx.clip();
  ctx.strokeStyle = color;
  ctx.lineWidth = 7;
  ctx.globalAlpha *= 0.22;
  ctx.lineCap = 'round';
  const hgt = y1 - y0;
  ctx.beginPath();
  for (let x = x0 - hgt, i = 0; x < x1 + 20; x += 15, i++) {
    const j = hs(i, seed) * 4;
    ctx.moveTo(x + j, y1 + 10);
    ctx.lineTo(x + hgt + j + 10, y0 - 10);
  }
  ctx.stroke();
  ctx.restore();
}

/** simple sketchy stroke helper */
export function stroke(ctx, pts, color = INK, lw = 5, o = {}) {
  shape(ctx, pts, { ...o, closed: false, stroke: color, lw, fill: null });
}
export function circle(ctx, cx, cy, r, o = {}) {
  shape(ctx, ell(cx, cy, r, r), o);
}

// ---------- sticker (white cut-out border + drop shadow) ----------
let layer = null;
let lctx = null;
// the sticker layer works in device pixels, so it matches the output canvas (not the design space)
export function initLayer(w = OUT_W, h = OUT_H) {
  layer = document.createElement('canvas');
  layer.width = w;
  layer.height = h;
  lctx = layer.getContext('2d');
}
/**
 * Draws fn() as a paper sticker: white backing w/ soft shadow, then content.
 * o: {shadow: 0..1, border, dy}
 */
export function sticker(ctx, fn, o = {}) {
  const border = o.border ?? 11;
  const m = ctx.getTransform();
  const scale = Math.hypot(m.a, m.b);
  lctx.setTransform(1, 0, 0, 1, 0, 0);
  if (lastBB) lctx.clearRect(lastBB[0], lastBB[1], lastBB[2] - lastBB[0], lastBB[3] - lastBB[1]);
  else lctx.clearRect(0, 0, layer.width, layer.height);
  lctx.setTransform(m);
  lctx.globalAlpha = 1;
  const prevPass = S.pass;
  const prevB = S.border;
  const prevBB = S.bb;
  S.pass = 'back';
  S.border = border;
  S.bb = [Infinity, Infinity, -Infinity, -Infinity];
  fn(lctx);
  let bb = S.bb;
  S.pass = prevPass;
  S.border = prevB;
  S.bb = prevBB;
  if (bb[0] === Infinity) bb = [0, 0, layer.width, layer.height];
  bb = [Math.max(0, Math.floor(bb[0]) - 2), Math.max(0, Math.floor(bb[1]) - 2), Math.min(layer.width, Math.ceil(bb[2]) + 2), Math.min(layer.height, Math.ceil(bb[3]) + 2)];
  lastBB = bb;
  // collect bbox for QA layout check (zero cost when S.collect is null)
  if (S.collect !== null) {
    S.collect.push({ x0: bb[0], y0: bb[1], x1: bb[2], y1: bb[3], scene: S.scene });
  }
  if (prevBB) {
    // nested sticker: extend the parent's bbox too
    prevBB[0] = Math.min(prevBB[0], bb[0]); prevBB[1] = Math.min(prevBB[1], bb[1]);
    prevBB[2] = Math.max(prevBB[2], bb[2]); prevBB[3] = Math.max(prevBB[3], bb[3]);
  }
  const bw = bb[2] - bb[0], bh = bb[3] - bb[1];
  if (bw > 0 && bh > 0 && S.pass !== 'back') {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const sh = o.shadow ?? 1;
    if (sh > 0) {
      ctx.shadowColor = `rgba(25,20,40,${0.32 * sh})`;
      ctx.shadowBlur = 16 * scale;
      ctx.shadowOffsetX = 3 * scale;
      ctx.shadowOffsetY = (o.dy ?? 9) * scale;
    }
    ctx.drawImage(layer, bb[0], bb[1], bw, bh, bb[0], bb[1], bw, bh);
    ctx.restore();
  }
  fn(ctx);
}
let lastBB = null;

// ---------- torn paper ----------
const tornCache = new Map();
export function tornRectPts(x, y, w, h, seed = 1, jag = 7, step = 16) {
  const key = [x, y, w, h, seed, jag, step].join(',');
  if (tornCache.has(key)) return tornCache.get(key);
  const r = rng(seed * 997 + 13);
  const pts = [];
  const edge = (ax, ay, bx, by, nx, ny) => {
    const d = Math.hypot(bx - ax, by - ay);
    const k = Math.max(2, Math.round(d / step));
    for (let i = 0; i < k; i++) {
      const t = i / k;
      const o = (r() - 0.5) * 2 * jag + (r() < 0.12 ? (r() - 0.5) * jag * 2 : 0);
      pts.push([ax + (bx - ax) * t + nx * o, ay + (by - ay) * t + ny * o]);
    }
  };
  edge(x, y, x + w, y, 0, 1);
  edge(x + w, y, x + w, y + h, 1, 0);
  edge(x + w, y + h, x, y + h, 0, 1);
  edge(x, y + h, x, y, 1, 0);
  tornCache.set(key, pts);
  return pts;
}
function polyPath(ctx, pts) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
}
/** torn paper piece; fiber edge is a lighter ring drawn under the colored piece */
export function torn(ctx, pts, color, o = {}) {
  ctx.save();
  if (o.shadow !== false) {
    ctx.shadowColor = `rgba(30,20,10,${o.shadowA ?? 0.28})`;
    ctx.shadowBlur = o.blur ?? 14;
    ctx.shadowOffsetY = o.dy ?? 6;
    ctx.shadowOffsetX = 2;
  }
  polyPath(ctx, pts);
  ctx.fillStyle = o.edge ?? '#FBF6EA';
  ctx.fill();
  ctx.restore();
  // inset colored layer (shift slightly for torn fiber reveal)
  ctx.save();
  ctx.translate(o.ix ?? 2, o.iy ?? 3);
  let cx = 0, cy = 0;
  for (const p of pts) { cx += p[0]; cy += p[1]; }
  cx /= pts.length; cy /= pts.length;
  const inset = o.inset ?? 4;
  const ip = pts.map((p) => {
    const dx = p[0] - cx, dy = p[1] - cy;
    const d = Math.hypot(dx, dy) || 1;
    const k = (d - inset - hash(p[0], p[1]) * inset) / d;
    return [cx + dx * k, cy + dy * k];
  });
  polyPath(ctx, ip);
  ctx.fillStyle = color;
  ctx.fill();
  if (o.clipFn) {
    ctx.clip();
    o.clipFn(ctx);
  }
  ctx.restore();
}
/** wavy torn strip spanning the width (sea / hills), top edge at y */
export function waveStrip(ctx, y, color, o = {}) {
  const amp = o.amp ?? 16;
  const wl = o.wl ?? 260;
  const ph = o.phase ?? 0;
  const x0 = o.x0 ?? -60;
  const x1 = o.x1 ?? W + 60;
  const bottom = o.bottom ?? H + 60;
  const pts = [];
  for (let x = x0; x <= x1; x += 14) {
    const yy = y + Math.sin((x / wl) * TAU + ph) * amp + hs(Math.round(x / 14), o.seed ?? 3) * 2.5;
    pts.push([x, yy]);
  }
  pts.push([x1, bottom], [x0, bottom]);
  torn(ctx, pts, color, { ...o, inset: 3, ix: 0, iy: 4, shadowA: o.shadowA ?? 0.22 });
}

// ---------- text ----------
/**
 * Handwritten / display text with per-letter wobble & reveal.
 * o: {font, size, color, align, weight, reveal, wobble, stroke, strokeW, spacing, baseline}
 */
export function text(ctx, str, x, y, o = {}) {
  const size = o.size ?? 60;
  const fam = FONT[o.font ?? 'hand'] ?? o.font;
  const weight = o.weight ?? (o.font === 'hand' || !o.font ? 700 : 400);
  ctx.font = `${weight} ${size}px ${fam}`;
  ctx.textBaseline = o.baseline ?? 'middle';
  ctx.textAlign = 'left';
  const spacing = o.spacing ?? 0;
  const chars = [...str];
  const widths = chars.map((c) => ctx.measureText(c).width + spacing);
  const total = widths.reduce((a, b) => a + b, 0) - spacing;
  const align = o.align ?? 'center';
  let cx = align === 'center' ? x - total / 2 : align === 'right' ? x - total : x;
  const reveal = o.reveal ?? 1;
  const nVis = reveal * chars.length;
  const wob = o.wobble ?? 1;
  const back = S.pass === 'back';
  for (let i = 0; i < chars.length; i++) {
    const vis = clamp(nVis - i);
    if (vis <= 0) break;
    const ch = chars[i];
    const w = widths[i];
    const rot = hs(i, S.boil, 3.3) * 0.045 * wob;
    const dy = hs(i, S.boil, 7.7) * 1.8 * wob;
    ctx.save();
    ctx.translate(cx + w / 2, y + dy);
    ctx.rotate(rot);
    const sc = vis < 1 ? 0.4 + 0.6 * vis : 1;
    ctx.scale(sc, sc);
    if (back) {
      bbAdd(ctx, 0, 0, Math.max(w, size) + S.border * 2);
      ctx.lineJoin = 'round';
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = S.border * 2 + (o.strokeW ?? 0) * 2;
      ctx.strokeText(ch, -w / 2 + spacing / 2, 0);
      ctx.fillStyle = '#fff';
      ctx.fillText(ch, -w / 2 + spacing / 2, 0);
    } else {
      ctx.globalAlpha *= vis < 1 ? vis : 1;
      if (o.stroke) {
        ctx.lineJoin = 'round';
        ctx.strokeStyle = o.stroke;
        ctx.lineWidth = o.strokeW ?? 6;
        ctx.strokeText(ch, -w / 2 + spacing / 2, 0);
      }
      if (o.shadowColor) {
        ctx.fillStyle = o.shadowColor;
        ctx.fillText(ch, -w / 2 + spacing / 2 + (o.sx ?? 4), o.sy ?? 4);
      }
      ctx.fillStyle = o.color ?? INK;
      ctx.fillText(ch, -w / 2 + spacing / 2, 0);
    }
    ctx.restore();
    cx += w;
  }
  return total;
}
export function measure(ctx, str, o = {}) {
  const size = o.size ?? 60;
  const fam = FONT[o.font ?? 'hand'] ?? o.font;
  const weight = o.weight ?? (o.font === 'hand' || !o.font ? 700 : 400);
  ctx.font = `${weight} ${size}px ${fam}`;
  return ctx.measureText(str).width + (o.spacing ?? 0) * (str.length - 1);
}

/** translucent marker highlight bar */
export function highlight(ctx, x, y, w, h, color, p = 1, seed = 1) {
  if (p <= 0 || S.pass === 'back') return;
  const pts = [];
  const n = 14;
  const ww = w * p;
  for (let i = 0; i <= n; i++) pts.push([x + (ww * i) / n, y - h / 2 + hs(i, seed) * 3]);
  for (let i = n; i >= 0; i--) pts.push([x + (ww * i) / n, y + h / 2 + hs(i, seed + 3) * 3]);
  ctx.save();
  ctx.globalAlpha *= 0.55;
  ctx.fillStyle = color;
  polyPath(ctx, pts);
  ctx.fill();
  ctx.restore();
}

/** scribbled underline that draws on */
export function underline(ctx, x, y, w, color, p = 1, lw = 8, seed = 2) {
  const pts = [];
  for (let i = 0; i <= 20; i++) pts.push([x + (w * i) / 20, y + Math.sin(i * 0.9 + seed) * 3 + (i / 20) * -6]);
  pts.push([x + w - 10, y + 10], [x + 30, y + 14]);
  stroke(ctx, partial(pts, p), color, lw, { double: false, amp: 1.5, seed });
}

/** hand-drawn arrow along a curve */
export function arrow(ctx, pts, color = INK, lw = 6, p = 1, o = {}) {
  const pp = partial(pts, p);
  stroke(ctx, pp, color, lw, o);
  if (p > 0.85 && pp.length > 1) {
    const a = pp[pp.length - 1];
    const b = pp[Math.max(0, pp.length - 3)];
    const ang = Math.atan2(a[1] - b[1], a[0] - b[0]);
    const L = o.head ?? 26;
    stroke(ctx, [[a[0] + Math.cos(ang + 2.6) * L, a[1] + Math.sin(ang + 2.6) * L], a, [a[0] + Math.cos(ang - 2.6) * L, a[1] + Math.sin(ang - 2.6) * L]], color, lw, o);
  }
}

/** doodle star / sparkle */
export function sparkle(ctx, x, y, r, color = C.yellow, rot = 0) {
  const pts = [];
  for (let i = 0; i < 8; i++) {
    const a = rot + (i * Math.PI) / 4;
    const rr = i % 2 ? r * 0.38 : r;
    pts.push([x + Math.cos(a) * rr, y + Math.sin(a) * rr]);
  }
  shape(ctx, resample(pts, 10, true), { fill: color, lw: 3.5, amp: 1 });
}

// ---------- paper texture ----------
export function makePaperTexture(w = W + 128, h = H + 128) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const x = c.getContext('2d');
  const img = x.createImageData(w, h);
  const d = img.data;
  const r = rng(42);
  for (let i = 0; i < d.length; i += 4) {
    const v = 128 + (r() - 0.5) * 38;
    d[i] = d[i + 1] = d[i + 2] = v;
    d[i + 3] = 255;
  }
  x.putImageData(img, 0, 0);
  // fibers
  x.lineCap = 'round';
  for (let i = 0; i < 2600; i++) {
    const px = r() * w, py = r() * h;
    const a = r() * TAU, l = 6 + r() * 26;
    x.strokeStyle = r() < 0.5 ? 'rgba(255,255,255,0.22)' : 'rgba(0,0,0,0.12)';
    x.lineWidth = 0.6 + r() * 1.2;
    x.beginPath();
    x.moveTo(px, py);
    x.quadraticCurveTo(px + Math.cos(a + 0.5) * l * 0.5, py + Math.sin(a + 0.5) * l * 0.5, px + Math.cos(a) * l, py + Math.sin(a) * l);
    x.stroke();
  }
  // blotches
  for (let i = 0; i < 90; i++) {
    const px = r() * w, py = r() * h, rr = 40 + r() * 160;
    const g = x.createRadialGradient(px, py, 0, px, py, rr);
    const dark = r() < 0.5;
    g.addColorStop(0, dark ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.06)');
    g.addColorStop(1, 'rgba(128,128,128,0)');
    x.fillStyle = g;
    x.fillRect(px - rr, py - rr, rr * 2, rr * 2);
  }
  return c;
}

/** cached offscreen canvases (for expensive static art) */
const cache = new Map();
export function cached(key, w, h, fn) {
  if (cache.has(key)) return cache.get(key);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  fn(c.getContext('2d'), c);
  cache.set(key, c);
  return c;
}
