// Cut transitions, drawn over the scenes. A video declares them in timeline.js:
//   export const TRANSITIONS = [
//     { t: T.s2, type: 'swipe', color: 'navy2', dir: 1 },           // torn-paper sheet wipes across the cut
//     { t: T.s3, type: 'iris', color: 'cyan', x: 960, y: 560 },     // paper ring bursts open
//     { t: T.end, type: 'flash' },                                  // white flash (e.g. on a camera shutter)
//     { type: 'eyelids', close: T.blink, shut: T.blinkEnd, open: T.s2 }, // eyes close and open on the cut
//   ];
// Colours may be palette keys or CSS colours. The film always fades to dark over its last 0.45 s.
import { W, H, TAU, prog, ease, hash, hs } from '../../util.js';
import { DURATION } from '../../data.js';
import { S, C, INK, shape, stroke, torn, tornRectPts, col } from './draw.js';

export const SWIPE_HALF = 0.32;
const SWIPE_COLORS = ['navy2', '#FFD27A', 'cyan', 'teal'];

function swipe(ctx, t, sw, i) {
  const u = (t - sw.t) / SWIPE_HALF;
  if (u <= -1 || u >= 1) return;
  const color = col(sw.color ?? SWIPE_COLORS[i % SWIPE_COLORS.length]);
  const dir = sw.dir ?? (i % 2 ? -1 : 1);
  const seed = sw.seed ?? i + 1;
  const e = Math.sign(u) * Math.pow(Math.abs(u), 0.85);
  const sheetW = W + 900;
  const sheetH = Math.max(W, H) * 1.6; // tall enough to cover vertical frames at the tilt
  const cx = W / 2 - e * (W / 2 + sheetW / 2 + 60) * dir;
  ctx.save();
  ctx.translate(cx, H / 2);
  ctx.rotate(-0.1 * dir);
  torn(ctx, tornRectPts(-sheetW / 2, -sheetH / 2, sheetW, sheetH, seed * 13, 16, 26), color, { shadowA: 0.35, blur: 30, dy: 0 });
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 10;
  ctx.lineCap = 'round';
  const rows = Math.ceil(H / 170);
  for (let r = 0; r < rows; r++) {
    const y = -H / 2 + r * 170 + 40, x0 = -sheetW / 2 + 200 + hash(r, seed) * 400;
    ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x0 + 300 + hash(r, 3) * 700, y); ctx.stroke();
  }
  ctx.restore();
}

/** eyelids close at `close`, are shut by `shut`, open again at `open` */
function eyelids(ctx, t, tr) {
  const pc = ease.inCubic(prog(t, tr.close - 0.05, tr.shut ?? tr.close + 0.3));
  const po = ease.outCubic(prog(t, tr.open + 0.05, tr.open + 0.38));
  const cl = pc * (1 - po);
  if (cl <= 0) return;
  const lid = (dir) => {
    const edgeY = H / 2 - dir * (1 - cl) * (H / 2 + 80);
    const bulge = (1 - cl) * 90 + 10;
    const pts = [];
    for (let i = 0; i <= 24; i++) {
      const x = -60 + ((W + 120) * i) / 24, u = (x - W / 2) / (W / 2);
      pts.push([x, edgeY + dir * bulge * (1 - u * u)]);
    }
    const far = dir > 0 ? -80 : H + 80;
    shape(ctx, [...pts, [W + 60, far], [-60, far]], { fill: col(tr.color ?? '#F4DCC4'), lw: 10, amp: 2.5, hatch: '#c89a70' });
    if (cl > 0.4 && S.pass !== 'back') for (let i = 2; i < 23; i += 2) { const [x, y] = pts[i]; stroke(ctx, [[x, y], [x + (i - 12) * 2, y + dir * 36]], INK, 6, { double: false }); }
  };
  lid(1);
  lid(-1);
}

/** paper iris burst centred at (x, y) */
function iris(ctx, t, tr) {
  const p = prog(t, tr.t - 0.02, tr.t + 0.42);
  if (p <= 0 || p >= 1) return;
  const r = ease.inCubic(p) * Math.hypot(W, H) * 0.7;
  const x = tr.x ?? W / 2, y = tr.y ?? H / 2;
  ctx.save();
  ctx.globalAlpha = 1 - p;
  const pts = [];
  for (let i = 0; i < 40; i++) { const a = (i / 40) * TAU, rr = r * (1 + hs(i, 3) * 0.06); pts.push([x + Math.cos(a) * rr, y + Math.sin(a) * rr]); }
  ctx.beginPath();
  pts.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
  ctx.closePath();
  ctx.lineWidth = 60 * (1 - p) + 6;
  ctx.strokeStyle = col(tr.color ?? '#fff');
  ctx.stroke();
  ctx.restore();
}

function flash(ctx, t, tr) {
  const f = 1 - prog(t, tr.t, tr.t + (tr.dur ?? 0.45));
  if (t < tr.t || f <= 0) return;
  ctx.fillStyle = `rgba(255,255,255,${f * 0.95})`;
  ctx.fillRect(-200, -200, W + 400, H + 400);
}

const KINDS = { swipe, eyelids, iris, flash };

/** draws every transition active at t, then the closing fade */
export function drawTransitions(ctx, t, list = []) {
  let swipeIdx = 0;
  for (const tr of list) {
    const fn = KINDS[tr.type];
    if (!fn) continue;
    ctx.save();
    fn(ctx, t, tr, tr.type === 'swipe' ? swipeIdx++ : 0);
    ctx.restore();
  }
  const fo = prog(t, DURATION - 0.45, DURATION);
  if (fo > 0) { ctx.fillStyle = `rgba(17,24,39,${fo})`; ctx.fillRect(-200, -200, W + 400, H + 400); }
}

/** default sound for each transition (scene sfx format); `sfx: false` on a transition mutes it */
export function transitionSfx(list = []) {
  const out = [];
  let i = 0;
  for (const tr of list) {
    if (tr.sfx === false) continue;
    if (tr.type === 'swipe') {
      const dir = tr.dir ?? (i % 2 ? -1 : 1);
      i++;
      out.push({ t: tr.t - 0.28, kind: 'whoosh', dur: 0.56, vel: 0.24, dir }, { t: tr.t - 0.1, kind: 'paper', dur: 0.25, vel: 0.12 });
    } else if (tr.type === 'iris') out.push({ t: tr.t - 0.05, kind: 'paper', dur: 0.3, vel: 0.2 });
    else if (tr.type === 'eyelids') out.push({ t: tr.close - 0.05, kind: 'whoosh', dur: 0.25, vel: 0.2, f0: 900, f1: 2400, f2: 500 }, { t: (tr.shut ?? tr.close + 0.3) - 0.02, kind: 'thud', vel: 0.3 });
  }
  return out;
}
