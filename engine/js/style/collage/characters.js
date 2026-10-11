// Posable stick-figure puppets in a storyboard-comic style.
// Looks may use palette keys ('teal') or CSS colours; theme.json `characters` adds or overrides looks.
import { DEG, TAU, hash } from '../../util.js';
import { S, C, INK, THEME_DATA, col, shape, stroke, ell, resample, sticker } from './draw.js';

export const LOOKS = {
  casual: { hair: 'messy', hairColor: '#4A3426', shirtColor: 'teal', bottom: 'pants', bottomColor: 'navy' },
  cap: { hat: 'cap', shirtColor: 'coral', bottom: 'shorts', bottomColor: 'charcoal' },
  blonde: { hair: 'pony', hairColor: '#F2C94C', shirtColor: '#FF7A6B', bottom: 'pants', bottomColor: '#5B7DB1' },
  brown: { hair: 'messy', hairColor: '#7A4A2A', shirtColor: '#8EC5E8', bottom: 'shorts', bottomColor: '#C9A46A' },
  mom: { hair: 'long', hairColor: '#8B4A2B', shirtColor: '#E8574F', bottom: 'pants', bottomColor: '#5B7DB1' },
  kid1: { hair: 'messy', hairColor: '#8B5A2B', shirtColor: '#7CCB6B', bottom: 'shorts', bottomColor: '#3E5C9A' },
  kid2: { hair: 'messy', hairColor: '#D9822B', shirtColor: '#FFC93C', bottom: 'shorts', bottomColor: '#2FA487' },
  grandpa: { hair: 'bald', hairColor: '#DDDDDD', shirtColor: '#9B7BD1', bottom: 'pants', bottomColor: '#6B6B6B', glasses: true },
  ...(THEME_DATA.characters ?? {}),
};
/** a look with its colours resolved against the palette */
function resolveLook(l) {
  const out = { ...l };
  for (const k of ['hairColor', 'shirtColor', 'bottomColor']) if (out[k]) out[k] = col(out[k]);
  return out;
}

const armGeo = (sg, a, b) => {
  const sh = [sg * 44, -250];
  const t1 = a * DEG;
  const el = [sh[0] + sg * Math.sin(t1) * 62, sh[1] + Math.cos(t1) * 62];
  const t2 = (a + b) * DEG;
  const hd = [el[0] + sg * Math.sin(t2) * 56, el[1] + Math.cos(t2) * 56];
  return { sh, el, hd, t1 };
};

/**
 * Draw a person with feet at (x,y).
 * o: {look, s, armL:{a,b}, armR:{a,b}, mouth, eyes, brow, face (-1..1), t, seed,
 *     phone:'L'|'R', legs:number (leg length factor), sticker:bool, rot, blink:bool, blush}
 */
export function person(ctx, x, y, o = {}) {
  const s = o.s ?? 1;
  ctx.save();
  ctx.translate(x, y);
  if (o.rot) ctx.rotate(o.rot);
  ctx.scale(s * (o.flip ? -1 : 1), s);
  const draw = (c) => body(c, o);
  if (o.sticker === false) draw(ctx);
  else sticker(ctx, draw, { border: 9 / s + 2, shadow: o.shadow ?? 1 });
  ctx.restore();
}

function body(ctx, o) {
  const L = resolveLook(typeof o.look === 'string' ? LOOKS[o.look] ?? LOOKS.casual : o.look || LOOKS.casual);
  const t = o.t ?? S.t;
  const seed = o.seed ?? 1;
  const fs = (o.face ?? 0.3) >= 0 ? 1 : -1;
  const fx = (o.face ?? 0.3) * 14;
  const legF = o.legs ?? 1;
  const armL = o.armL ?? { a: 14, b: -8 };
  const armR = o.armR ?? { a: 14, b: -8 };
  const lw = 6;

  // ----- back hair -----
  if (L.hair === 'long') {
    shape(ctx, resample([[-64, -380], [-78, -300], [-80, -238], [-40, -236], [0, -250], [40, -236], [80, -238], [78, -300], [64, -380]], 18, true), { fill: L.hairColor, lw: 5, hatch: '#5a2a15' });
  }
  if (L.hair === 'pony') {
    const px = -fs * 70;
    shape(ctx, ell(px, -318, 26, 52), { fill: L.hairColor, lw: 5 });
    stroke(ctx, [[px + fs * 14, -366], [px + fs * 24, -356]], INK, 5);
  }

  // ----- legs -----
  const legLen = 88 * legF;
  const walk = o.walk ? Math.sin(t * 9 + seed) * 16 : 0;
  for (const sg of [-1, 1]) {
    const hip = [sg * 22, -100];
    const knee = o.sit ? [sg * 34, -80] : null;
    const foot = o.sit ? [sg * 36, -80 + 70 * legF] : [sg * 26 + (sg === 1 ? walk : -walk), -100 + legLen];
    const legPts = knee ? [hip, knee, foot] : [hip, foot];
    if (L.bottom === 'pants') {
      const ank = [foot[0], foot[1] - 12];
      shape(ctx, knee ? [hip, knee, ank] : [hip, ank], { closed: false, stroke: L.bottomColor, lw: 30, double: false, amp: 1 });
      stroke(ctx, [[foot[0], foot[1] - 14], foot], INK, lw);
    } else {
      stroke(ctx, resample(legPts, 20), INK, lw, { amp: 1.2 });
    }
    if (knee && L.bottom !== 'pants') shape(ctx, ell(knee[0], knee[1] + 4, 16, 12), { fill: L.bottomColor, lw: 4.5 });
    shape(ctx, ell(foot[0] + fs * 8, foot[1] - 2, 20, 11), { fill: INK, lw: 3, amp: 0.8 });
  }
  // ----- bottoms -----
  if (L.bottom === 'shorts') {
    shape(ctx, resample([[-48, -158], [48, -158], [54, -94], [6, -94], [0, -114], [-6, -94], [-54, -94]], 18, true), { fill: L.bottomColor, lw: 5, hatch: '#000' });
  } else {
    shape(ctx, resample([[-48, -158], [48, -158], [46, -110], [-46, -110]], 18, true), { fill: L.bottomColor, lw: 5 });
  }

  // ----- torso -----
  const torso = resample([[-46, -266], [46, -266], [56, -240], [50, -150], [-50, -150], [-56, -240]], 16, true);
  shape(ctx, torso, { fill: L.shirtColor, lw: 5, hatch: L.shirt === 'palm' ? null : '#000' });
  if (L.shirt === 'palm' && S.pass !== 'back') palmPrint(ctx, torso);
  if (L.shirt === 'palm') {
    // open collar + buttons
    stroke(ctx, [[-22, -266], [0, -236], [22, -266]], INK, 4);
    if (S.pass !== 'back') {
      ctx.fillStyle = '#ddd';
      for (const by of [-222, -196, -170]) { ctx.beginPath(); ctx.arc(2, by, 3.2, 0, TAU); ctx.fill(); }
    }
  } else {
    stroke(ctx, ell(0, -266, 18, 10, 0.1, Math.PI - 0.1), INK, 4);
  }

  // ----- arms -----
  for (const [sg, arm, side] of [[-1, armL, 'L'], [1, armR, 'R']]) {
    const g = armGeo(sg, arm.a, arm.b);
    stroke(ctx, resample([g.sh, g.el, g.hd], 16), INK, lw, { amp: 1.1 });
    // sleeve
    const dx = g.el[0] - g.sh[0], dy = g.el[1] - g.sh[1];
    const d = Math.hypot(dx, dy);
    const ux = dx / d, uy = dy / d;
    const px = -uy, py = ux;
    const sl = 30, sw = 19;
    const s0 = [g.sh[0] - ux * 8, g.sh[1] - uy * 8];
    const s1 = [g.sh[0] + ux * sl, g.sh[1] + uy * sl];
    shape(ctx, resample([[s0[0] + px * sw, s0[1] + py * sw], [s1[0] + px * sw * 0.9, s1[1] + py * sw * 0.9], [s1[0] - px * sw * 0.9, s1[1] - py * sw * 0.9], [s0[0] - px * sw, s0[1] - py * sw]], 12, true), { fill: L.shirtColor, lw: 4.5 });
    if (o.phone === side) phoneInHand(ctx, g.hd, o);
    else if (o.thumb === side) thumbUp(ctx, g.hd, sg);
    else shape(ctx, ell(g.hd[0], g.hd[1], 10, 10), { fill: '#fff', lw: 4 });
  }

  // ----- neck + head -----
  stroke(ctx, [[0, -282], [0, -262]], INK, lw);
  const hr = 60;
  shape(ctx, ell(0, -338, hr, hr * 0.98), { fill: C.skin, lw: 5.5 });

  // ----- face -----
  if (S.pass !== 'back') face(ctx, o, fx, t, seed);

  // ----- hat / hair front -----
  if (L.hat === 'cap') {
    shape(ctx, resample([...ell(0, -368, 62, 46, Math.PI, TAU, 16), [60, -366], [-60, -366]], 16, true), { fill: C.teal, lw: 5, hatch: '#000' });
    shape(ctx, resample([[fs * 8, -376], [fs * 70, -382], [fs * 112, -370], [fs * 104, -360], [fs * 20, -364]], 14, true), { fill: C.tealDark, lw: 5 });
    shape(ctx, ell(0, -414, 7, 5), { fill: C.teal, lw: 3 });
    stroke(ctx, [[-4, -413], [-14, -372]], INK, 2.5, { double: false });
  } else if (L.hair === 'messy') {
    const pts = [];
    for (let a = 190, i = 0; a <= 350; a += 13, i++) {
      const r = i % 2 ? 60 : 76 + hash(i, 3) * 6;
      pts.push([Math.cos(a * DEG) * r, -338 + Math.sin(a * DEG) * r]);
    }
    for (let a = 350; a >= 190; a -= 20) pts.push([Math.cos(a * DEG) * 50, -338 + Math.sin(a * DEG) * 44 - 14]);
    shape(ctx, resample(pts, 12, true), { fill: L.hairColor, lw: 5 });
  } else if (L.hair === 'pony' || L.hair === 'long') {
    const pts = [];
    for (let a = 178; a <= 362; a += 12) pts.push([Math.cos(a * DEG) * 67, -338 + Math.sin(a * DEG) * 66]);
    const inner = [[fs * 64, -352], [fs * 36, -386], [-fs * 6, -380], [-fs * 44, -368], [-fs * 66, -342]];
    pts.push(...(fs > 0 ? inner : inner.reverse()));
    shape(ctx, resample(pts, 12, true), { fill: L.hairColor, lw: 5 });
  }
  if (L.hair === 'bald') {
    for (const sg of [-1, 1]) shape(ctx, resample([[sg * 50, -372], [sg * 70, -352], [sg * 66, -318], [sg * 56, -336]], 8, true), { fill: L.hairColor, lw: 4 });
  }
  if (L.glasses && S.pass !== 'back') {
    shape(ctx, ell(fx - 21, -340, 15, 13), { lw: 4 });
    shape(ctx, ell(fx + 21, -340, 15, 13), { lw: 4 });
  }
}

function face(ctx, o, fx, t, seed) {
  const blinkNow = o.blink !== false && ((t * 1.0 + seed * 0.77) % 3.4) < 0.13;
  const eyes = blinkNow ? 'closed' : o.eyes ?? 'dot';
  const ey = -340;
  ctx.fillStyle = INK;
  for (const sg of [-1, 1]) {
    const ex = fx + sg * 21;
    if (eyes === 'dot') {
      ctx.beginPath();
      ctx.ellipse(ex, ey, 6.5, 7.5, 0, 0, TAU);
      ctx.fill();
    } else if (eyes === 'wide') {
      shape(ctx, ell(ex, ey, 12, 13), { fill: '#fff', lw: 3.5 });
      ctx.fillStyle = INK;
      ctx.beginPath();
      ctx.arc(ex + fx * 0.15, ey + 2, 5.5, 0, TAU);
      ctx.fill();
    } else if (eyes === 'happy') {
      stroke(ctx, [[ex - 9, ey + 3], [ex, ey - 7], [ex + 9, ey + 3]], INK, 4.5, { double: false });
    } else if (eyes === 'closed') {
      stroke(ctx, [[ex - 9, ey], [ex + 9, ey]], INK, 4.5, { double: false });
    } else if (eyes === 'star') {
      starEye(ctx, ex, ey);
    }
  }
  if (o.brow === 'worried') {
    stroke(ctx, [[fx - 32, -358], [fx - 12, -366]], INK, 4, { double: false });
    stroke(ctx, [[fx + 32, -358], [fx + 12, -366]], INK, 4, { double: false });
  } else if (o.brow === 'raised') {
    stroke(ctx, ell(fx - 21, -359, 12, 6, Math.PI + 0.3, TAU - 0.3), INK, 4, { double: false });
    stroke(ctx, ell(fx + 21, -359, 12, 6, Math.PI + 0.3, TAU - 0.3), INK, 4, { double: false });
  } else if (o.brow === 'angry') {
    stroke(ctx, [[fx - 32, -366], [fx - 12, -358]], INK, 4, { double: false });
    stroke(ctx, [[fx + 32, -366], [fx + 12, -358]], INK, 4, { double: false });
  }
  if (o.blush !== false) {
    ctx.save();
    ctx.globalAlpha *= 0.3;
    ctx.fillStyle = C.pink;
    ctx.beginPath();
    ctx.ellipse(fx - 36, -316, 11, 6, 0, 0, TAU);
    ctx.ellipse(fx + 36, -316, 11, 6, 0, 0, TAU);
    ctx.fill();
    ctx.restore();
  }
  const m = o.mouth ?? 'smile';
  const my = -313;
  if (m === 'smile') stroke(ctx, [[fx - 20, my - 2], [fx - 8, my + 9], [fx + 8, my + 9], [fx + 20, my - 2]], INK, 4.5, { double: false });
  else if (m === 'open' || m === 'grin') {
    const w = m === 'grin' ? 28 : 21;
    const d = m === 'grin' ? 30 : 24;
    shape(ctx, resample([[fx - w, my - 4], [fx + w, my - 4], ...ell(fx, my - 4, w, d, 0, Math.PI, 10).slice(1, -1)], 10, true), { fill: '#E8605A', lw: 4, double: false });
    if (m === 'grin') stroke(ctx, [[fx - w + 5, my + 2], [fx + w - 5, my + 2]], '#fff', 5, { double: false });
  } else if (m === 'o') shape(ctx, ell(fx, my + 2, 9, 12), { fill: '#7A2E2E', lw: 3.5, double: false });
  else if (m === 'flat') stroke(ctx, [[fx - 14, my + 2], [fx + 14, my + 2]], INK, 4.5, { double: false });
  else if (m === 'frown') stroke(ctx, [[fx - 18, my + 8], [fx, my - 2], [fx + 18, my + 8]], INK, 4.5, { double: false });
  else if (m === 'wavy') stroke(ctx, [[fx - 20, my + 3], [fx - 10, my - 3], [fx, my + 3], [fx + 10, my - 3], [fx + 20, my + 3]], INK, 4, { double: false });
}

function starEye(ctx, x, y) {
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const r = i % 2 ? 5 : 12;
    pts.push([x + Math.cos(a) * r, y + Math.sin(a) * r]);
  }
  shape(ctx, pts, { fill: C.yellow, lw: 3, amp: 0.5, double: false });
}

function palmPrint(ctx, torso) {
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(torso[0][0], torso[0][1]);
  for (const p of torso) ctx.lineTo(p[0], p[1]);
  ctx.closePath();
  ctx.clip();
  const palms = [[-30, -238], [16, -250], [-6, -200], [30, -186], [-34, -176], [36, -226], [6, -162]];
  ctx.strokeStyle = '#3FC1A0';
  ctx.fillStyle = '#3FC1A0';
  ctx.lineCap = 'round';
  palms.forEach(([x, y], i) => {
    const b = hash(i, S.boil) * 0.15;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x - 2, y + 16);
    ctx.quadraticCurveTo(x + 4, y + 8, x, y);
    ctx.stroke();
    for (let k = 0; k < 5; k++) {
      const a = -Math.PI / 2 + (k - 2) * 0.7 + b;
      ctx.beginPath();
      ctx.ellipse(x + Math.cos(a) * 8, y + Math.sin(a) * 6, 9, 3.2, a, 0, TAU);
      ctx.fill();
    }
  });
  ctx.restore();
}

function phoneInHand(ctx, hd, o) {
  ctx.save();
  ctx.translate(hd[0], hd[1] - 22);
  ctx.rotate(o.phoneRot ?? 0.08);
  shape(ctx, resample([[-20, -36], [20, -36], [20, 36], [-20, 36]], 10, true), { fill: '#1d2230', lw: 4.5, amp: 0.8 });
  if (S.pass !== 'back') {
    ctx.fillStyle = o.phoneScreen ?? C.accent;
    ctx.globalAlpha *= 0.9;
    ctx.fillRect(-14, -28, 28, 54);
    ctx.globalAlpha = 1;
    // tiny UI lines
    ctx.fillStyle = 'rgba(17,24,39,0.6)';
    ctx.fillRect(-10, -20, 20, 4);
    ctx.fillRect(-10, -10, 12, 4);
    ctx.beginPath();
    ctx.arc(0, 10, 8, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
  shape(ctx, ell(hd[0], hd[1], 10, 10), { fill: '#fff', lw: 4 });
}

function thumbUp(ctx, hd, sg) {
  shape(ctx, ell(hd[0], hd[1], 13, 12), { fill: '#fff', lw: 4 });
  shape(ctx, resample([[hd[0] - 5, hd[1] - 8], [hd[0] - 6, hd[1] - 30], [hd[0] + 4, hd[1] - 30], [hd[0] + 5, hd[1] - 8]], 8, true), { fill: '#fff', lw: 4 });
}

// ---------- pose presets ----------
export const POSE = {
  idle: { armL: { a: 14, b: -8 }, armR: { a: 14, b: -8 } },
  hips: { armL: { a: 50, b: -100 }, armR: { a: 50, b: -100 } },
  shrug: { armL: { a: 70, b: 70 }, armR: { a: 70, b: 70 } },
  cheer: { armL: { a: 150, b: 15 }, armR: { a: 150, b: 15 } },
  phoneR: { armL: { a: 14, b: -8 }, armR: { a: 22, b: 118 }, phone: 'R' },
  phoneL: { armL: { a: 22, b: 118 }, armR: { a: 14, b: -8 }, phone: 'L' },
  point: { armL: { a: 14, b: -8 }, armR: { a: 95, b: -5 } },
  thumbs: { armL: { a: 14, b: -8 }, armR: { a: 35, b: 110 }, thumb: 'R' },
};
/** waving right arm helper */
export function wave(t, speed = 9) {
  return { a: 145, b: 25 + Math.sin(t * speed) * 22 };
}
