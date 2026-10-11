// Collage props: boat, sun, clouds, phone, polaroids, maps, bubbles, icons, logo.
import { W, H, SCALE, TAU, DEG, clamp, hash, hs, rng, prog, ease } from '../../util.js';
import { S, C, INK, FONT, THEME_DATA, bbAdd, shape, stroke, ell, rrect, resample, quad, bez, partial, sticker, text, circle, torn, tornRectPts, cached, arrow, sparkle } from './draw.js';

export const IMG = {};
export function loadImages(list) {
  return Promise.all(
    Object.entries(list).map(
      ([k, src]) =>
        new Promise((res) => {
          const im = new Image();
          im.onload = () => {
            if (/\.svg$/.test(src)) {
              // rasterize vectors once (drawing an SVG image re-rasterizes it every frame);
              // 1000 px wide at 1080p, more for larger outputs so QR codes / logos stay crisp
              const w = Math.round(1000 * Math.max(1, SCALE)), h = Math.round((w * (im.naturalHeight || im.height)) / (im.naturalWidth || im.width));
              const c = document.createElement('canvas');
              c.width = w;
              c.height = h;
              c.getContext('2d').drawImage(im, 0, 0, w, h);
              IMG[k] = c;
            } else IMG[k] = im;
            res();
          };
          im.onerror = () => { console.warn('img failed', src); res(); };
          im.src = src;
        })
    )
  );
}

// ---------------- boat ----------------
/** yacht with waterline at (x,y). o: {s, t, rot, wifi, sticker, flagColor, sailColor} */
export function boat(ctx, x, y, o = {}) {
  const s = o.s ?? 1;
  const t = o.t ?? S.t;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate((o.rot ?? 0) + Math.sin(t * 1.7 + (o.seed ?? 0)) * 0.025);
  ctx.scale(s * (o.flip ? -1 : 1), s);
  const draw = (c) => boatBody(c, o, t);
  if (o.sticker === false) draw(ctx);
  else sticker(ctx, draw, { border: 10 / s + 1, shadow: o.shadow ?? 1 });
  ctx.restore();
}
function boatBody(ctx, o, t) {
  // sails first (behind hull top)
  const mastX = -10;
  stroke(ctx, [[mastX, -58], [mastX, -470]], INK, 7, { amp: 0.8 });
  const main = [[mastX + 4, -458], ...quad([mastX + 4, -458], [-150, -262], [-228, -122], 14).slice(1), [mastX + 4, -126]];
  shape(ctx, resample(main, 18, true), { fill: o.sailColor ?? '#FFFDF4', lw: 5, hatch: '#9ED8EE' });
  const jib = [[mastX + 12, -440], [276, -80], ...quad([276, -80], [150, -96], [34, -98], 8).slice(1)];
  shape(ctx, resample(jib, 18, true), { fill: '#FFFFFF', lw: 5, hatch: '#9ED8EE' });
  if (S.pass !== 'back') {
    ctx.strokeStyle = 'rgba(27,31,42,0.35)';
    ctx.lineWidth = 2.5;
    for (let i = 1; i < 4; i++) {
      ctx.beginPath();
      ctx.moveTo(mastX + 4, -126 - i * 80);
      ctx.lineTo(-40 - i * 30 - 150 + i * 60, -126 - i * 60);
      ctx.stroke();
    }
  }
  if (o.wifi && S.pass !== 'back') wifiIcon(ctx, -95, -250, 0.75, o.wifi, C.cyanDeep);
  stroke(ctx, [[mastX, -124], [-232, -116]], INK, 6);
  // flag
  const fw = Math.sin(t * 8) * 6;
  shape(ctx, resample([[mastX, -470], [mastX + 52, -462 + fw], [mastX, -448]], 10, true), { fill: o.flagColor ?? C.cyan, lw: 4 });
  // cabin
  shape(ctx, rrect(-160, -100, 190, 52, 14), { fill: '#FFFFFF', lw: 5 });
  if (S.pass !== 'back') {
    ctx.fillStyle = C.navy2;
    for (const wx of [-140, -92, -44]) ctx.fillRect(wx, -86, 34, 16);
  }
  // hull
  const hull = resample([[-266, -54], [292, -76], [248, -22], [198, 8], [-212, 10], [-254, -14]], 18, true);
  shape(ctx, hull, { fill: '#FFFFFF', lw: 6 });
  shape(ctx, resample([[-262, -42], [283, -64], [272, -50], [-258, -28]], 18, true), { fill: C.navy2, lw: 0, stroke: null, noBack: true });
  shape(ctx, resample([[-226, -2], [214, -3], [206, 5], [-216, 7]], 18, true), { fill: C.cyan, lw: 0, stroke: null, noBack: true });
  if (S.pass !== 'back') {
    for (const px of [60, 120, 180]) shape(ctx, ell(px, -26, 9, 8), { fill: C.sky2, lw: 3, double: false });
  }
  // rail
  stroke(ctx, [[-250, -58], [-250, -84], [240, -104], [270, -80]], INK, 3, { double: false });
}

// ---------------- sky bits ----------------
export function sun(ctx, x, y, r, o = {}) {
  const t = o.t ?? S.t;
  ctx.save();
  ctx.translate(x, y);
  sticker(ctx, (c) => {
    c.save();
    c.rotate(t * 0.35);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * TAU;
      const r0 = r * 1.18, r1 = r * (1.55 + (i % 2) * 0.18);
      shape(c, resample([[Math.cos(a - 0.12) * r0, Math.sin(a - 0.12) * r0], [Math.cos(a) * r1, Math.sin(a) * r1], [Math.cos(a + 0.12) * r0, Math.sin(a + 0.12) * r0]], 10, true), { fill: C.sun, lw: 4 });
    }
    c.restore();
    shape(c, ell(0, 0, r, r), { fill: C.sun, lw: 5, hatch: C.orange });
    if (o.face !== false && S.pass !== 'back') {
      if (o.shades) {
        shape(c, rrect(-r * 0.62, -r * 0.3, r * 0.52, r * 0.34, 10), { fill: INK, lw: 3 });
        shape(c, rrect(r * 0.1, -r * 0.3, r * 0.52, r * 0.34, 10), { fill: INK, lw: 3 });
        stroke(c, [[-r * 0.1, -r * 0.2], [r * 0.1, -r * 0.2]], INK, 4);
      } else {
        c.fillStyle = INK;
        c.beginPath();
        c.arc(-r * 0.3, -r * 0.15, r * 0.08, 0, TAU);
        c.arc(r * 0.3, -r * 0.15, r * 0.08, 0, TAU);
        c.fill();
      }
      stroke(c, quad([-r * 0.35, r * 0.25], [0, r * 0.55], [r * 0.35, r * 0.25]), INK, 5);
    }
  }, { shadow: 0.6 });
  ctx.restore();
}
export function moon(ctx, x, y, r) {
  ctx.save();
  ctx.translate(x, y);
  sticker(ctx, (c) => {
    const pts = [...ell(0, 0, r, r, -1.9, 1.9, 20), ...ell(r * 0.45, 0, r * 0.8, r * 0.85, 1.6, -1.6, 16)];
    shape(c, resample(pts, 12, true), { fill: '#FFF3B0', lw: 5 });
  }, { shadow: 0.5 });
  ctx.restore();
}
export function cloud(ctx, x, y, s = 1, o = {}) {
  const circles = [[-70, 10, 44], [-25, -18, 58], [35, -8, 50], [78, 14, 38], [0, 20, 44]];
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  const draw = (c) => {
    if (S.pass === 'back') {
      c.fillStyle = '#fff';
      for (const [cx, cy, r] of circles) { bbAdd(c, cx, cy, r + S.border + 4); c.beginPath(); c.arc(cx, cy, r + S.border, 0, TAU); c.fill(); }
      return;
    }
    for (const [cx, cy, r] of circles) shape(c, ell(cx, cy, r, r), { fill: null, lw: 9, double: false, amp: 1.5 });
    for (const [cx, cy, r] of circles) shape(c, ell(cx, cy, r, r), { fill: o.color ?? '#FFFFFF', stroke: null, amp: 1.5 });
    c.save();
    c.globalAlpha *= 0.25;
    for (const [cx, cy, r] of circles) shape(c, ell(cx + 6, cy + 10, r * 0.7, r * 0.5), { fill: C.sky, stroke: null });
    c.restore();
  };
  if (o.sticker === false) draw(ctx);
  else sticker(ctx, draw, { shadow: 0.4, border: 8 });
  ctx.restore();
}
export function gull(ctx, x, y, s, t) {
  const f = Math.sin(t * 7) * 9;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  stroke(ctx, [[-34, f], [-16, -12 - f * 0.4], [0, 0], [16, -12 - f * 0.4], [34, f]], INK, 5, { double: false });
  ctx.restore();
}

// ---------------- phone ----------------
/** phone centered at (cx,cy) with height h, screen image key or draw fn */
export function phone(ctx, cx, cy, h, screen, o = {}) {
  const w = h * 0.485;
  ctx.save();
  ctx.translate(cx, cy);
  if (o.rot) ctx.rotate(o.rot);
  const draw = (c) => {
    shape(c, rrect(-w / 2, -h / 2, w, h, w * 0.16), { fill: '#0E1320', lw: 7, amp: 1.5 });
    if (S.pass === 'back') return;
    const m = w * 0.045;
    const sx = -w / 2 + m, sy = -h / 2 + m, sw = w - m * 2, sh = h - m * 2;
    c.save();
    roundClip(c, sx, sy, sw, sh, w * 0.12);
    c.fillStyle = C.navy;
    c.fillRect(sx, sy, sw, sh);
    if (typeof screen === 'string' && IMG[screen]) {
      const im = IMG[screen];
      const k = Math.max(sw / im.width, sh / im.height);
      c.drawImage(im, sx + (sw - im.width * k) / 2, sy + (sh - im.height * k) / 2, im.width * k, im.height * k);
    } else if (typeof screen === 'function') {
      screen(c, sx, sy, sw, sh);
    }
    if (o.overlay) o.overlay(c, sx, sy, sw, sh);
    // glare
    const g = c.createLinearGradient(sx, sy, sx + sw, sy + sh);
    g.addColorStop(0, 'rgba(255,255,255,0.10)');
    g.addColorStop(0.45, 'rgba(255,255,255,0.0)');
    g.addColorStop(1, 'rgba(255,255,255,0.04)');
    c.fillStyle = g;
    c.fillRect(sx, sy, sw, sh);
    c.restore();
    // dynamic island
    c.fillStyle = '#05070c';
    c.beginPath();
    c.roundRect(-w * 0.14, -h / 2 + m + h * 0.012, w * 0.28, h * 0.03, h * 0.015);
    c.fill();
  };
  if (o.sticker === false) draw(ctx);
  else sticker(ctx, draw, { border: o.border ?? 12, shadow: 1, dy: 14 });
  ctx.restore();
}
function roundClip(c, x, y, w, h, r) {
  c.beginPath();
  c.roundRect(x, y, w, h, r);
  c.clip();
}

// ---------------- polaroid ----------------
export function polaroid(ctx, x, y, w, content, caption, o = {}) {
  const h = w * 1.18;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(o.rot ?? 0);
  const draw = (c) => {
    shape(c, resample([[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]], 30, true), { fill: '#FFFEFA', lw: 3, amp: 0.8, double: false, stroke: 'rgba(0,0,0,0.25)' });
    if (S.pass === 'back') return;
    const m = w * 0.06;
    const pw = w - m * 2;
    const key = `pola:${o.key ?? caption}:${Math.round(pw)}:${o.blur ?? 0}`;
    const pic = cached(key, Math.ceil(pw), Math.ceil(pw), (cc) => {
      if (o.blur) cc.filter = `blur(${o.blur}px)`;
      content(cc, pw, pw);
      cc.filter = 'none';
    });
    c.drawImage(pic, -w / 2 + m, -h / 2 + m, pw, pw);
    c.strokeStyle = 'rgba(0,0,0,0.25)';
    c.lineWidth = 2;
    c.strokeRect(-w / 2 + m, -h / 2 + m, pw, pw);
    if (caption) text(c, caption, 0, h / 2 - (h - w) * 0.5 - m * 0.2 + m * 0.4, { font: 'hand', size: w * 0.12, color: '#333' });
  };
  sticker(ctx, draw, { border: 2, shadow: 1, dy: 10 });
  ctx.restore();
}

// ---------------- islands & maps ----------------
export function islandPts(cx, cy, rx, ry, seed, n = 26) {
  const r = rng(seed);
  const off = [];
  for (let i = 0; i < 6; i++) off.push([r() * TAU, 0.08 + r() * 0.16, 2 + Math.floor(r() * 4)]);
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    let k = 1;
    for (const [ph, amp, fr] of off) k += Math.sin(a * fr + ph) * amp;
    pts.push([cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k]);
  }
  return pts;
}
export function island(ctx, cx, cy, rx, ry, seed, o = {}) {
  const pts = islandPts(cx, cy, rx, ry, seed);
  shape(ctx, pts, { fill: C.sand, lw: o.lw ?? 4, amp: 1.2 });
  const inner = pts.map(([x, y]) => [cx + (x - cx) * 0.78, cy + (y - cy) * 0.74 - 3]);
  shape(ctx, inner, { fill: o.green ?? C.green, stroke: null, hatch: '#3d7a2a' });
  if (o.trees && S.pass !== 'back') {
    const r = rng(seed + 5);
    ctx.fillStyle = '#4E9A3A';
    for (let i = 0; i < o.trees; i++) {
      const tx = cx + (r() - 0.5) * rx * 1.0, ty = cy + (r() - 0.5) * ry * 0.9;
      ctx.beginPath();
      ctx.arc(tx, ty, 6 + r() * 5, 0, TAU);
      ctx.fill();
    }
  }
}
export function compass(ctx, x, y, r, rot = 0) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  circle(ctx, 0, 0, r, { lw: 3.5, fill: 'rgba(255,255,255,0.35)' });
  shape(ctx, resample([[0, -r * 1.25], [r * 0.2, 0], [0, r * 1.25], [-r * 0.2, 0]], 8, true), { fill: C.red, lw: 3 });
  shape(ctx, resample([[-r * 1.25, 0], [0, r * 0.2], [r * 1.25, 0], [0, -r * 0.2]], 8, true), { fill: '#fff', lw: 3 });
  ctx.restore();
  text(ctx, 'N', x, y - r * 1.6, { font: 'marker', size: r * 0.7, color: INK });
}
/** dashed route line (partial p) */
export function route(ctx, pts, p, color = C.red, lw = 6, dash = [4, 14]) {
  const pp = partial(pts, p);
  if (pp.length < 2 || S.pass === 'back') return pp[pp.length - 1];
  ctx.save();
  ctx.setLineDash(dash);
  ctx.lineCap = 'round';
  ctx.strokeStyle = color;
  ctx.lineWidth = lw;
  ctx.beginPath();
  ctx.moveTo(pp[0][0], pp[0][1]);
  for (let i = 1; i < pp.length; i++) ctx.lineTo(pp[i][0], pp[i][1]);
  ctx.stroke();
  ctx.restore();
  return pp[pp.length - 1];
}
/** small boat marker (top-down arrow) */
export function boatPin(ctx, x, y, ang, color, s = 1, label) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(ang);
  ctx.scale(s, s);
  shape(ctx, resample([[26, 0], [-16, -14], [-8, 0], [-16, 14]], 8, true), { fill: color, lw: 4, amp: 0.8 });
  ctx.restore();
  if (label && S.pass !== 'back') {
    const w = label.length * 13 * s + 26;
    ctx.save();
    ctx.translate(x, y - 44 * s);
    shape(ctx, rrect(-w / 2, -17 * s, w, 34 * s, 10), { fill: '#fff', lw: 3, double: false, amp: 0.8 });
    text(ctx, label, 0, 1, { font: 'inter', weight: 700, size: 19 * s, color: INK, wobble: 0 });
    ctx.restore();
  }
}

// ---------------- speech bubble ----------------
export function bubble(ctx, x, y, w, h, tail, str, o = {}) {
  ctx.save();
  ctx.translate(x, y);
  const draw = (c) => {
    const pts = ell(0, 0, w / 2, h / 2, 0, TAU, 40);
    // splice a tail in toward tail point
    const ta = Math.atan2(tail[1], tail[0]);
    let best = 0, bd = 1e9;
    pts.forEach((p, i) => {
      const d = Math.abs(Math.atan2(p[1], p[0]) - ta);
      if (d < bd) { bd = d; best = i; }
    });
    const n = pts.length;
    const a = pts[(best - 2 + n) % n], b = pts[(best + 2) % n];
    const out = [];
    for (let i = 0; i < n; i++) {
      const k = (i - best + n) % n;
      if (k === n - 2 || k === n - 1 || k === 0 || k === 1 || k === 2) {
        if (k === 0) out.push(a, tail, b);
        continue;
      }
      out.push(pts[i]);
    }
    shape(c, resample(out, 16, true), { fill: o.fill ?? '#fff', lw: 5 });
    if (S.pass !== 'back') text(c, str, 0, 2, { font: o.font ?? 'hand', size: o.size ?? h * 0.36, color: o.color ?? INK, weight: 700 });
  };
  sticker(ctx, draw, { shadow: 0.8, border: 7 });
  ctx.restore();
}

// ---------------- icons ----------------
export function wifiIcon(ctx, x, y, s = 1, p = 1, color = C.cyan, off = 'rgba(27,31,42,0.25)') {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  const arcs = [26, 54, 82];
  circle(ctx, 0, 0, 10, { fill: p > 0 ? color : off, lw: 4 });
  arcs.forEach((r, i) => {
    const on = p * 3.3 > i + 0.3;
    stroke(ctx, ell(0, 0, r, r, -Math.PI * 0.78, -Math.PI * 0.22, 10), on ? color : off, 14, { double: false, amp: 1 });
  });
  ctx.restore();
}
export function checkMark(ctx, x, y, s, p, color = C.teal, lw = 16) {
  const pts = resample([[x - 40 * s, y], [x - 10 * s, y + 32 * s], [x + 50 * s, y - 42 * s]], 10);
  stroke(ctx, partial(pts, p), color, lw * s, { double: false, amp: 1.2 });
}
export function xMark(ctx, x, y, s, p, color = C.red, lw = 12) {
  const a = resample([[x - 40 * s, y - 36 * s], [x + 40 * s, y + 36 * s]], 10);
  const b = resample([[x + 40 * s, y - 36 * s], [x - 40 * s, y + 36 * s]], 10);
  stroke(ctx, partial(a, clamp(p * 2)), color, lw * s, { double: false });
  if (p > 0.5) stroke(ctx, partial(b, clamp(p * 2 - 1)), color, lw * s, { double: false });
}
export function stopwatch(ctx, x, y, r, frac, o = {}) {
  ctx.save();
  ctx.translate(x, y);
  sticker(ctx, (c) => {
    shape(c, rrect(-r * 0.18, -r * 1.32, r * 0.36, r * 0.26, 6), { fill: C.cyanDeep, lw: 4 });
    shape(c, ell(0, 0, r, r), { fill: '#fff', lw: 6 });
    if (S.pass === 'back') return;
    c.save();
    c.fillStyle = 'rgba(1,215,252,0.35)';
    c.beginPath();
    c.moveTo(0, 0);
    c.arc(0, 0, r * 0.86, -Math.PI / 2, -Math.PI / 2 + frac * TAU);
    c.closePath();
    c.fill();
    c.restore();
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * TAU;
      stroke(c, [[Math.cos(a) * r * 0.78, Math.sin(a) * r * 0.78], [Math.cos(a) * r * 0.9, Math.sin(a) * r * 0.9]], INK, 3, { double: false, amp: 0.5 });
    }
    const a = -Math.PI / 2 + frac * TAU;
    stroke(c, [[0, 0], [Math.cos(a) * r * 0.72, Math.sin(a) * r * 0.72]], C.red, 6, { double: false, amp: 0.5 });
    circle(c, 0, 0, 7, { fill: INK, lw: 2 });
    if (o.label) text(c, o.label, 0, r * 0.38, { font: 'orb', weight: 700, size: r * 0.3, color: INK, wobble: 0 });
  }, { shadow: 0.9 });
  ctx.restore();
}
export function creditCard(ctx, x, y, s) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  shape(ctx, rrect(-70, -45, 140, 90, 12), { fill: '#FFB63B', lw: 5, hatch: '#c46c00' });
  shape(ctx, rrect(-70, -28, 140, 18, 2), { fill: INK, stroke: null, noBack: true });
  shape(ctx, rrect(-54, 4, 30, 22, 4), { fill: '#EEE', lw: 3 });
  stroke(ctx, [[-10, 26], [50, 26]], INK, 4, { double: false });
  ctx.restore();
}
export function keypad(ctx, x, y, s) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  shape(ctx, rrect(-58, -58, 116, 116, 14), { fill: '#D6E4F0', lw: 5 });
  if (S.pass !== 'back') {
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) circle(ctx, -32 + i * 32, -32 + j * 32, 10, { fill: '#fff', lw: 3, double: false });
    text(ctx, '****', 0, 0, { font: 'orb', weight: 900, size: 26, color: C.red, wobble: 0 });
  }
  ctx.restore();
}
export function gear(ctx, x, y, s, rot = 0) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.scale(s, s);
  const pts = [];
  for (let i = 0; i < 40; i++) {
    const a = (i / 40) * TAU;
    const r = (Math.floor(i / 2.5) % 2 ? 44 : 58);
    pts.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  shape(ctx, pts, { fill: '#B8C2CC', lw: 5, amp: 0.8 });
  circle(ctx, 0, 0, 18, { fill: '#fff', lw: 4 });
  ctx.restore();
}
export function trophy(ctx, x, y, s) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  sticker(ctx, (c) => {
    stroke(c, ell(-52, -60, 26, 30, Math.PI * 0.5, Math.PI * 1.5), INK, 7);
    stroke(c, ell(52, -60, 26, 30, -Math.PI * 0.5, Math.PI * 0.5), INK, 7);
    shape(c, resample([[-56, -100], [56, -100], [44, -30], [14, -6], [-14, -6], [-44, -30]], 14, true), { fill: '#FFC83D', lw: 6, hatch: '#c98a00' });
    shape(c, rrect(-12, -8, 24, 34, 3), { fill: '#FFC83D', lw: 5 });
    shape(c, rrect(-44, 24, 88, 24, 5), { fill: C.woodDark, lw: 5 });
    if (S.pass !== 'back') sparkle(c, 30, -78, 12, '#fff');
  }, { shadow: 0.9 });
  ctx.restore();
}
/** steering wheel + two-value instrument display. vals = [left, right]; o.labels, o.units */
export function helmDisplay(ctx, x, y, s, vals, o = {}) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  const t = o.t ?? S.t;
  sticker(ctx, (c) => {
    // steering wheel
    c.save();
    c.translate(0, 120);
    c.rotate(Math.sin(t * 0.8) * 0.12);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU;
      stroke(c, [[Math.cos(a) * 40, Math.sin(a) * 40], [Math.cos(a) * 250, Math.sin(a) * 250]], '#9AA3AD', 12);
      if (S.pass !== 'back') stroke(c, [[Math.cos(a) * 250, Math.sin(a) * 250], [Math.cos(a) * 290, Math.sin(a) * 290]], C.woodDark, 16);
    }
    stroke(c, ell(0, 0, 250, 250), '#C3CAD2', 22, { closed: true });
    circle(c, 0, 0, 44, { fill: '#9AA3AD', lw: 6 });
    c.restore();
    // display
    shape(c, rrect(-230, -170, 460, 250, 30), { fill: '#0B1220', lw: 8, amp: 1.2 });
    if (S.pass === 'back') return;
    c.fillStyle = '#131C2E';
    c.beginPath();
    c.roundRect(-205, -148, 410, 206, 16);
    c.fill();
    const [l0, l1] = o.labels ?? ['SOG', 'TWS'];
    const [u0, u1] = o.units ?? ['kn', 'kn'];
    text(c, l0, -110, -118, { font: 'orb', weight: 700, size: 22, color: '#7F8AA3', wobble: 0 });
    text(c, l1, 110, -118, { font: 'orb', weight: 700, size: 22, color: '#7F8AA3', wobble: 0 });
    text(c, vals[0], -110, -50, { font: 'orb', weight: 700, size: 74, color: C.cyan, wobble: 0 });
    text(c, vals[1], 110, -50, { font: 'orb', weight: 700, size: 74, color: C.lime, wobble: 0 });
    text(c, u0, -110, 8, { font: 'orb', weight: 500, size: 22, color: '#7F8AA3', wobble: 0 });
    text(c, u1, 110, 8, { font: 'orb', weight: 500, size: 22, color: '#7F8AA3', wobble: 0 });
    stroke(c, [[0, -140], [0, 40]], '#2A3550', 3, { double: false });
  }, { shadow: 1 });
  ctx.restore();
}
export function padlock(ctx, x, y, s, rot = 0) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.scale(s, s);
  sticker(ctx, (c) => {
    stroke(c, ell(0, -40, 34, 40, Math.PI, TAU), '#8C96A3', 14);
    shape(c, rrect(-50, -44, 100, 82, 12), { fill: '#FFC83D', lw: 6, hatch: '#b37b00' });
    circle(c, 0, -12, 10, { fill: INK, lw: 2 });
    stroke(c, [[0, -8], [0, 16]], INK, 7);
  }, { shadow: 0.9 });
  ctx.restore();
}
export function chain(ctx, pts, p = 1) {
  const pp = partial(resample(pts, 26), p);
  for (let i = 0; i < pp.length; i++) {
    const [x, y] = pp[i];
    const n = pp[Math.min(i + 1, pp.length - 1)], q = pp[Math.max(i - 1, 0)];
    const a = Math.atan2(n[1] - q[1], n[0] - q[0]);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(a + (i % 2 ? Math.PI / 2 : 0) * 0.0);
    const flat = i % 2 === 0;
    shape(ctx, ell(0, 0, 18, flat ? 10 : 4), { fill: null, stroke: '#7E8894', lw: 6, double: false, amp: 0.6 });
    ctx.restore();
  }
}

// ---------------- living room ----------------
export function couch(ctx, x, y, w, o = {}) {
  ctx.save();
  ctx.translate(x, y);
  const col = o.color ?? '#D9A066';
  // part 'back': backrest + seat (draw before sitters); part 'arms': armrests (after)
  if (o.part !== 'arms') {
    shape(ctx, rrect(-w / 2, -300, w, 230, 40), { fill: col, lw: 6, hatch: '#9c6630' });
    shape(ctx, rrect(-w / 2 + 40, -110, w - 80, 70, 20), { fill: '#E7B77E', lw: 6 });
    shape(ctx, rrect(-w / 2 + 40, -44, w - 80, 44, 8), { fill: '#B77B45', lw: 5 });
  }
  if (o.part !== 'back') {
    shape(ctx, rrect(-w / 2 - 20, -190, 90, 190, 30), { fill: col, lw: 6, hatch: '#9c6630' });
    shape(ctx, rrect(w / 2 - 70, -190, 90, 190, 30), { fill: col, lw: 6, hatch: '#9c6630' });
  }
  ctx.restore();
}
export function laptop(ctx, x, y, s, screenFn) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  sticker(ctx, (c) => {
    shape(c, rrect(-110, -150, 220, 140, 10), { fill: '#3A4150', lw: 5 });
    if (S.pass !== 'back') {
      c.save();
      c.beginPath();
      c.rect(-98, -138, 196, 116);
      c.clip();
      c.fillStyle = C.sky;
      c.fillRect(-98, -138, 196, 116);
      if (screenFn) screenFn(c, -98, -138, 196, 116);
      c.restore();
    }
    shape(c, resample([[-130, -10], [130, -10], [150, 12], [-150, 12]], 14, true), { fill: '#C9D0D8', lw: 5 });
  }, { shadow: 0.8, border: 6 });
  ctx.restore();
}
export function frame(ctx, x, y, w, h, fn) {
  ctx.save();
  ctx.translate(x, y);
  shape(ctx, rrect(-w / 2, -h / 2, w, h, 4), { fill: C.woodDark, lw: 5 });
  shape(ctx, rrect(-w / 2 + 14, -h / 2 + 14, w - 28, h - 28, 2), { fill: C.sky2, lw: 3, double: false });
  if (fn) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(-w / 2 + 16, -h / 2 + 16, w - 32, h - 32);
    ctx.clip();
    fn(ctx, w - 32, h - 32);
    ctx.restore();
  }
  ctx.restore();
}

// ---------------- badges / brand ----------------
/**
 * Brand logo centred at (x,y), from theme.logo:
 *   { type: 'text', text, accent?, color? }  -> layered display text (shadow, accent offset, face)
 *   { type: 'image', image: <manifest key> } -> the image, `size` = its height
 * o: {p (0..1 type-on reveal for text), accent, color}. Returns the drawn width.
 */
export function logo(ctx, x, y, size, o = {}) {
  const L = THEME_DATA.logo ?? { type: 'text', text: THEME_DATA.name ?? 'Logo' };
  const p = o.p ?? 1;
  ctx.save();
  ctx.translate(x, y);
  if (L.type === 'image' && IMG[L.image]) {
    const im = IMG[L.image];
    const w = (size * im.width) / im.height;
    ctx.globalAlpha *= clamp(p);
    ctx.drawImage(im, -w / 2, -size / 2, w, size);
    ctx.restore();
    return w;
  }
  ctx.font = `700 ${size}px ${FONT[L.font ?? 'orb'] ?? L.font}`;
  ctx.textBaseline = 'middle';
  const str = L.text ?? THEME_DATA.name ?? 'Logo';
  const shown = str.slice(0, Math.ceil(str.length * p));
  const full = ctx.measureText(str).width;
  ctx.textAlign = 'left';
  const x0 = -full / 2;
  ctx.fillStyle = L.shadow ?? '#888888';
  ctx.fillText(shown, x0 - size * 0.05, -size * 0.025);
  ctx.fillStyle = o.accent ?? L.accent ?? C.cyan;
  ctx.fillText(shown, x0 + size * 0.075, 0);
  ctx.fillStyle = o.color ?? L.color ?? '#FFFFFF';
  ctx.fillText(shown, x0, 0);
  ctx.restore();
  return full;
}
/** pill badge with a label, e.g. premiumBadge(ctx, x, y, 1, { label: 'PRO' }) */
export function premiumBadge(ctx, x, y, s, o = {}) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(o.rot ?? -0.05);
  ctx.scale(s, s);
  sticker(ctx, (c) => {
    shape(c, rrect(-190, -52, 380, 104, 52), { fill: C.cyan, lw: 6 });
    if (S.pass === 'back') return;
    text(c, o.label ?? 'PREMIUM', 18, 2, { font: 'orb', weight: 900, size: 46, color: C.navy, wobble: 0.3, spacing: 3 });
    sparkle(c, -142, 0, 26, C.yellow, S.t * 0.8);
  }, { shadow: 1 });
  ctx.restore();
}
/** price tag sticker: o.price (big), o.label (handwritten, below) */
export function priceTag(ctx, x, y, s, o = {}) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(o.rot ?? 0.08);
  ctx.scale(s, s);
  sticker(ctx, (c) => {
    shape(c, resample([[-150, -60], [130, -60], [175, 0], [130, 60], [-150, 60]], 16, true), { fill: '#FFF3C4', lw: 6 });
    circle(c, 130, 0, 12, { fill: '#fff', lw: 4 });
    if (S.pass === 'back') return;
    text(c, o.price ?? THEME_DATA.constants?.price ?? '', -18, -12, { font: 'orb', weight: 900, size: 50, color: C.navy, wobble: 0.2 });
    text(c, o.label ?? THEME_DATA.constants?.priceLabel ?? '', -18, 32, { font: 'hand', size: 34, color: '#444' });
  }, { shadow: 1 });
  ctx.restore();
}
/** rubber stamp (cached offscreen with grunge) */
export function stamp(ctx, x, y, str, o = {}) {
  const color = o.color ?? C.cyanDeep;
  const fs = o.size ?? 90;
  const key = `stamp:${str}:${color}:${fs}`;
  const img = cached(key, fs * str.length * 0.8 + 140, fs * 1.9, (c, cv) => {
    const w = cv.width, h = cv.height;
    c.strokeStyle = color;
    c.fillStyle = color;
    c.lineWidth = 12;
    c.beginPath();
    c.roundRect(14, 14, w - 28, h - 28, 22);
    c.stroke();
    c.lineWidth = 4;
    c.beginPath();
    c.roundRect(32, 32, w - 64, h - 64, 14);
    c.stroke();
    c.font = `900 ${fs}px ${FONT.orb}`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(str, w / 2, h / 2 + 4);
    // grunge
    const r = rng(7);
    c.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 900; i++) {
      c.globalAlpha = 0.3 + r() * 0.7;
      c.beginPath();
      c.arc(r() * w, r() * h, r() * 3.2, 0, TAU);
      c.fill();
    }
    for (let i = 0; i < 12; i++) {
      c.globalAlpha = 0.5;
      c.lineWidth = 1 + r() * 2;
      c.beginPath();
      const yy = r() * h;
      c.moveTo(0, yy);
      c.lineTo(w, yy + (r() - 0.5) * 30);
      c.stroke();
    }
    c.globalCompositeOperation = 'source-over';
    c.globalAlpha = 1;
  });
  const p = o.p ?? 1;
  if (p <= 0) return;
  const k = 1 + (1 - ease.outCubic(clamp(p))) * 1.6;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(o.rot ?? -0.1);
  ctx.scale((o.s ?? 1) * k, (o.s ?? 1) * k);
  ctx.globalAlpha *= clamp(p * 2.5) * 0.92;
  ctx.drawImage(img, -img.width / 2, -img.height / 2);
  ctx.restore();
}
/** paper confetti burst; tau = seconds since burst */
export function confetti(ctx, x, y, tau, n = 60, seed = 3, spread = 1) {
  if (tau < 0 || tau > 3.5) return;
  const cols = [C.cyan, C.lime, C.coral, C.yellow, '#fff', C.teal];
  const r = rng(seed);
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + (r() - 0.5) * 2.6 * spread;
    const v = 700 + r() * 900;
    const drag = Math.exp(-tau * 1.6);
    const px = x + Math.cos(a) * v * (1 - drag) / 1.6 + Math.sin(tau * 4 + i) * 20;
    const py = y + Math.sin(a) * v * (1 - drag) / 1.6 + 260 * tau * tau * 0.5 + 120 * tau;
    const rot = tau * (4 + r() * 8) + r() * 6;
    const col = cols[Math.floor(r() * cols.length)];
    const w = 10 + r() * 14, h = 6 + r() * 8;
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(rot);
    ctx.scale(1, Math.cos(tau * 9 + i));
    ctx.globalAlpha *= clamp(3.5 - tau);
    ctx.fillStyle = col;
    ctx.fillRect(-w / 2, -h / 2, w, h);
    ctx.restore();
  }
}
export function img(ctx, key, x, y, w, o = {}) {
  const im = IMG[key];
  if (!im) return;
  const h = (w * im.height) / im.width;
  ctx.save();
  ctx.translate(x, y);
  if (o.rot) ctx.rotate(o.rot);
  if (o.sticker) {
    sticker(ctx, (c) => {
      if (S.pass === 'back') {
        bbAdd(c, -w / 2, -h / 2, S.border + 4);
        bbAdd(c, w / 2, h / 2, S.border + 4);
        bbAdd(c, -w / 2, h / 2, S.border + 4);
        bbAdd(c, w / 2, -h / 2, S.border + 4);
        c.fillStyle = '#fff';
        c.beginPath();
        c.roundRect(-w / 2 - S.border, -h / 2 - S.border, w + S.border * 2, h + S.border * 2, o.radius ?? 16);
        c.fill();
      } else c.drawImage(im, -w / 2, -h / 2, w, h);
    }, { border: o.border ?? 10 });
  } else ctx.drawImage(im, -w / 2, -h / 2, w, h);
  ctx.restore();
  return h;
}
export { arrow, sparkle };

// ---------------------------------------------------------------- AI collage art (v2)
/**
 * Draws a processed cut-out (white die-cut border baked in) as a paper sticker:
 * soft drop shadow + a tiny 8-fps "hand-placed" wobble.
 * anchor defaults to bottom-centre (characters stand on y). o: {h, rot, flip, sx, sy, alpha, ax, ay, shadow, boil}
 */
export function art(ctx, key, x, y, h, o = {}) {
  const im = IMG[key];
  if (!im || h <= 0) return;
  const w = (h * im.width) / im.height;
  const ax = o.ax ?? 0.5, ay = o.ay ?? 1;
  ctx.save();
  ctx.translate(x, y);
  const wob = o.boil === false ? 0 : hs(S.boil, key.length * 7.1, x * 0.01) * 0.006;
  ctx.rotate((o.rot ?? 0) + wob);
  ctx.scale((o.flip ? -1 : 1) * (o.sx ?? 1), o.sy ?? 1);
  if (o.alpha != null) ctx.globalAlpha *= o.alpha;
  const sh = o.shadow ?? 1;
  if (sh > 0) {
    const m = ctx.getTransform();
    const k = Math.hypot(m.a, m.b);
    ctx.shadowColor = `rgba(25,20,40,${0.34 * sh})`;
    ctx.shadowBlur = 18 * k;
    ctx.shadowOffsetX = 4 * k;
    ctx.shadowOffsetY = 10 * k;
  }
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(im, -w * ax, -h * ay, w, h);
  ctx.restore();
  return w;
}
/** full-frame backdrop with slow Ken-Burns push/pan. o: {zoom, fx, fy, dx, dy} fx/fy = focus 0..1 */
export function backdrop(ctx, key, lt, dur, o = {}) {
  const im = IMG[key];
  if (!im) return;
  const z0 = o.z0 ?? 1.02, z1 = o.zoom ?? 1.08;
  const p = ease.inOutSine(clamp(lt / dur));
  const k = Math.max(W / im.width, H / im.height) * lerpN(z0, z1, p);
  const w = im.width * k, h = im.height * k;
  const fx = o.fx ?? 0.5, fy = o.fy ?? 0.5;
  const x = W / 2 - w * fx + (o.dx ?? 0) * p;
  const y = H / 2 - h * fy + (o.dy ?? 0) * p;
  const bx = clampN(x, W - w, 0), by = clampN(y, H - h, 0);
  ctx.drawImage(im, bx, by, w, h);
  return { x: bx, y: by, k }; // source px -> canvas: x + sx * k
}
const lerpN = (a, b, t) => a + (b - a) * t;
const clampN = (v, a, b) => Math.min(b, Math.max(a, v));
