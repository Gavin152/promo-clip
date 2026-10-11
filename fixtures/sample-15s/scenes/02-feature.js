// 02 feature: "Try the feature. Tap once, and it just works."
import { prog, ease, pop, pick } from '@engine/util.js';
import { C, alpha, gridPaper, phone, dataTag, checkMark, caption, circle, rise, beatPulse } from '@engine/style/collage/index.js';
import THEME from '@project/theme.json';
import T from '@project/timeline.js';

export default {
  id: '02-feature',
  start: (T) => T.s2,
  layout: {
    land: { phone: [600, 560, 860], tags: [[1180, 330], [1560, 560]], check: [1330, 850, 1.6], cap: [1360, 120, 70] },
    vert: { phone: [630, 1020, 1040], tags: [[330, 1600], [930, 1600]], check: [1000, 640, 1.4], cap: [630, 330, 76] },
    sq: { phone: [380, 660, 880], tags: [[930, 360], [930, 660]], check: [930, 980, 1.3], cap: [880, 110, 62] },
  },
  sfx: (T) => [
    { t: T.phone, kind: 'pop', vel: 0.24, pitch: 0.9 },
    { t: T.tap, kind: 'noise', f: 3500, q: 2, vel: 0.2, decay: 0.03, len: 0.08 },
    { t: T.tags, kind: 'pop', vel: 0.22, pitch: 1.1 },
    { t: T.tags + 0.25, kind: 'pop', vel: 0.22, pitch: 1.3 },
    { t: T.works, kind: 'thud', vel: 0.4 },
    { t: T.works + 0.05, kind: 'arp', notes: [79, 83, 86, 91], gap: 0.07, vel: 0.1 },
  ],
  draw(ctx, lt, t, L) {
    gridPaper(ctx, C.cream, alpha('accent', 0.18), 54);
    const [px, py, ph] = L.phone;
    const up = rise(t, T.phone - 0.15, 0.5);
    const tapK = Math.exp(-Math.max(0, t - T.tap) * 5) * (t >= T.tap ? 1 : 0);
    phone(ctx, px, py + (1 - up) * 700, ph * (1 - tapK * 0.03), 'screen', {
      rot: -0.04,
      overlay: (c, sx, sy, sw, sh) => {
        if (t < T.tap) return;
        // tap ripple on the screen's main button
        const r = ease.outCubic(prog(t, T.tap, T.tap + 0.6));
        c.strokeStyle = `rgba(255,255,255,${0.9 * (1 - r)})`;
        c.lineWidth = 10;
        c.beginPath();
        c.arc(sx + sw / 2, sy + sh * 0.88, 30 + r * sw * 0.4, 0, Math.PI * 2);
        c.stroke();
      },
    });
    const tags = THEME.constants?.tags ?? [];
    L.tags.forEach(([x, y], i) => {
      const tg = tags[i];
      if (tg) dataTag(ctx, x, y, tg[0], tg[1], tg[2], pop(t, T.tags + i * 0.25, 0.45) * (1 + beatPulse(t) * 0.03), i ? 0.05 : -0.04, i ? C.coral : C.accent);
    });
    const [cx, cy, cs] = L.check;
    if (t > T.works - 0.1) {
      circle(ctx, cx, cy, 90 * cs * ease.outBack(prog(t, T.works - 0.1, T.works + 0.3)), { fill: '#FFFFFF', lw: 6 });
      checkMark(ctx, cx, cy, cs, prog(t, T.works, T.works + 0.35), C.teal, 18);
    }
    caption(ctx, pick('one tap. done.', 'one tap. done.'), L.cap[0], L.cap[1], t, T.tap, { size: L.cap[2], hl: C.lime });
  },
};
