// Scene-level collage helpers: camera moves, entrances, captions, title slams, backgrounds,
// data tags. Everything a scene needs on top of the draw primitives and props.
import { W, H, TAU, clamp, lerp, prog, ease, noise1, rng, shake } from '../../util.js';
import { BEATS } from '../../data.js';
import { S, C, INK, shape, ell, rrect, sticker, text, measure, torn, tornRectPts, highlight } from './draw.js';
import { IMG } from './props.js';

/** '#01D7FC' (or a palette key) + alpha -> 'rgba(1,215,252,a)' */
export function alpha(color, a) {
  const c = C[color] ?? color;
  if (!/^#[0-9a-f]{6}$/i.test(c)) return c;
  const n = parseInt(c.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
/** fills the whole frame (with overscan for shakes / camera moves) */
export function fill(ctx, color) {
  ctx.fillStyle = color;
  ctx.fillRect(-200, -200, W + 400, H + 400);
}
/** gentle handheld drift + slow push-in */
export function camera(ctx, lt, dur, zoom = 0.035, cx = W / 2, cy = H / 2) {
  const k = 1 + zoom * ease.inOutSine(clamp(lt / dur));
  const dx = noise1(lt * 0.35 + 3) * 5;
  const dy = noise1(lt * 0.35 + 11) * 4;
  ctx.translate(cx + dx, cy + dy);
  ctx.scale(k, k);
  ctx.translate(-cx, -cy);
}
/** decaying frame shake starting at t0 */
export function applyShake(ctx, t, t0, dur, amp) {
  const [x, y, r] = shake(t, t0, dur, amp);
  ctx.translate(W / 2 + x, H / 2 + y);
  ctx.rotate(r);
  ctx.translate(-W / 2, -H / 2);
}
/** draws fn(ctx) at (x,y) scaled by k (skipped while k ~ 0) */
export function popIn(ctx, x, y, k, fn, rot = 0) {
  if (k <= 0.001) return;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.scale(k, k);
  fn(ctx);
  ctx.restore();
}
/** slide-up entrance 0..1 (outBack) */
export const rise = (t, t0, d = 0.45, s = 1.4) => ease.outBack(prog(t, t0, t0 + d), s);
/** beat pulse 0..1 decaying after each music beat (for subtle bounces) */
export function beatPulse(t, decay = 0.18) {
  let last = -9;
  for (const b of BEATS) { if (b > t) break; last = b; }
  return Math.exp(-(t - last) / decay);
}
/**
 * handwritten caption sticker with write-on reveal.
 * o: {dur, rot, scale, size, font, align, hl (highlight colour), color, weight, sticker, border}
 */
export function caption(ctx, str, x, y, t, t0, o = {}) {
  const p = prog(t, t0, t0 + (o.dur ?? Math.max(0.3, str.length * 0.03)));
  if (p <= 0) return;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(o.rot ?? -0.03);
  if (o.scale) ctx.scale(o.scale, o.scale);
  const size = o.size ?? 64;
  const font = o.font ?? 'marker';
  const wdt = measure(ctx, str, { font, size });
  const align = o.align ?? 'center';
  const lx = align === 'left' ? 0 : align === 'right' ? -wdt : -wdt / 2;
  if (o.hl) highlight(ctx, lx - 10, size * 0.18, wdt + 20, size * 0.55, o.hl, clamp(p * 1.1), 5);
  const draw = (c) => text(c, str, 0, 0, { font, size, color: o.color ?? INK, align, reveal: p, weight: o.weight });
  if (o.sticker === false) draw(ctx);
  else sticker(ctx, draw, { border: o.border ?? 10, shadow: 0.7 });
  ctx.restore();
}
/** slam-in title: scales down from big with a thump. o: {rot, size, hl, color, border} */
export function slam(ctx, str, x, y, t, t0, o = {}) {
  const p = prog(t, t0, t0 + 0.22);
  if (p <= 0) return;
  const k = 1 + (1 - ease.outCubic(p)) * 1.2;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(o.rot ?? -0.03);
  ctx.scale(k, k);
  ctx.globalAlpha *= clamp(p * 3);
  const size = o.size ?? 120;
  const wdt = measure(ctx, str, { font: 'marker', size });
  if (o.hl) highlight(ctx, -wdt / 2 - 14, size * 0.2, wdt + 28, size * 0.55, o.hl, 1, 9);
  sticker(ctx, (c) => text(c, str, 0, 0, { font: 'marker', size, color: o.color ?? INK }), { border: o.border ?? 14, shadow: 0.8 });
  ctx.restore();
}
/** blends two '#rrggbb' colours */
export function mixColor(a, b, k) {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const r = Math.round(lerp((pa >> 16) & 255, (pb >> 16) & 255, k));
  const g = Math.round(lerp((pa >> 8) & 255, (pb >> 8) & 255, k));
  const bl = Math.round(lerp(pa & 255, pb & 255, k));
  return `rgb(${r},${g},${bl})`;
}
/** squared paper background */
export function gridPaper(ctx, bg, line, step = 48) {
  fill(ctx, bg);
  ctx.save();
  ctx.strokeStyle = line;
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let x = 0; x <= W; x += step) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
  for (let y = 0; y <= H; y += step) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
  ctx.stroke();
  ctx.restore();
}
/** twinkling doodle crosses scattered over the frame */
export function doodleStars(ctx, t, n = 26, seed = 9, color = alpha('cyan', 0.35)) {
  const r = rng(seed);
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  for (let i = 0; i < n; i++) {
    const x = r() * W, y = r() * H, s = 6 + r() * 10;
    ctx.globalAlpha = 0.6 + 0.4 * Math.sin(t * 3 + i);
    ctx.beginPath();
    ctx.moveTo(x - s, y); ctx.lineTo(x + s, y);
    ctx.moveTo(x, y - s); ctx.lineTo(x, y + s);
    ctx.stroke();
  }
  ctx.restore();
}
/** drifting little wave squiggles */
export function waveDoodles(ctx, t, color = 'rgba(255,255,255,0.35)', n = 14, seed = 4) {
  const r = rng(seed);
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  for (let i = 0; i < n; i++) {
    const x = ((r() * (W + 300) + t * (20 + r() * 30)) % (W + 300)) - 150;
    const y = r() * H;
    ctx.beginPath();
    for (let k = 0; k <= 3; k++) {
      const xx = x + k * 26, yy = y + (k % 2 ? -10 : 0);
      k === 0 ? ctx.moveTo(xx, yy) : ctx.quadraticCurveTo(xx - 13, yy + (k % 2 ? -8 : 8), xx, yy);
    }
    ctx.stroke();
  }
  ctx.restore();
}
/** soft radial glow */
export function glow(ctx, x, y, r, color = 'cyan', a = 0.28) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, alpha(color, a));
  g.addColorStop(1, alpha(color, 0));
  ctx.fillStyle = g;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
}
/** rotating sunburst rays (reveal backgrounds) */
export function sunburst(ctx, x, y, t, a = 1, color = 'cyan') {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(t * 0.12);
  ctx.globalAlpha *= a;
  for (let i = 0; i < 18; i++) {
    ctx.fillStyle = i % 2 ? alpha(color, 0.1) : 'rgba(255,255,255,0.04)';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, Math.max(W, H) * 1.2, (i / 18) * TAU, ((i + 1) / 18) * TAU);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}
/** dark data card: LABEL / big value + unit, popped in by k */
export function dataTag(ctx, x, y, label, value, unit, k, rot = 0, color = C.cyan) {
  popIn(ctx, x, y, k, (c) => {
    sticker(c, (cc) => {
      shape(cc, rrect(-150, -78, 300, 156, 22), { fill: C.navy, lw: 6 });
      if (S.pass === 'back') return;
      text(cc, label, 0, -44, { font: 'orb', weight: 700, size: 22, color: '#8FA0BC', spacing: 3, wobble: 0.3 });
      const vw = measure(cc, value, { font: 'orb', size: 64, weight: 700 });
      text(cc, value, unit ? -26 : 0, 14, { font: 'orb', weight: 700, size: 64, color, wobble: 0.3 });
      if (unit) text(cc, unit, vw / 2 - 12, 26, { font: 'orb', weight: 500, size: 26, color: '#8FA0BC', align: 'left', wobble: 0.3 });
    }, { border: 9 });
  }, rot);
}
/** push pin */
export function pin(ctx, x, y, color = C.red) {
  shape(ctx, ell(x, y, 13, 13), { fill: color, lw: 4 });
  if (S.pass !== 'back') {
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.beginPath();
    ctx.arc(x - 4, y - 4, 4, 0, TAU);
    ctx.fill();
  }
}
/** cork board background */
export function corkBoard(ctx) {
  fill(ctx, '#C9A47A');
  const r = rng(5);
  ctx.fillStyle = 'rgba(90,55,20,0.18)';
  for (let i = 0; i < 700; i++) { ctx.beginPath(); ctx.arc(r() * W, r() * H, 1 + r() * 3, 0, TAU); ctx.fill(); }
}
/** a torn-paper cut of an image (map scraps etc.). o: {jag, sx, sy, sw, sh} source crop */
export function tornImage(ctx, key, x, y, w, h, seed, o = {}) {
  const im = IMG[key];
  if (!im) return;
  torn(ctx, tornRectPts(x, y, w, h, seed, o.jag ?? 9), '#FBF6EA', {
    clipFn: (c) => {
      const sx = o.sx ?? 0, sy = o.sy ?? 0, sw = o.sw ?? im.width, sh = o.sh ?? im.height;
      c.drawImage(im, sx, sy, sw, sh, x, y, w, h);
    },
  });
}
/** puppet idle: gentle breathing squash + bob, returns {sy, dy} */
export function breathe(t, seed = 0, amp = 1) {
  return { sy: 1 + Math.sin(t * 2.4 + seed) * 0.012 * amp, dy: Math.sin(t * 2.4 + seed + 1) * 3 * amp };
}
