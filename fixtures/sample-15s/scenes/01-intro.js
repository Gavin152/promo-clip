// 01 intro: "Introducing Demo Product. Your week, sorted in seconds."
import { prog, ease, pop } from '@engine/util.js';
import { C, backdrop, art, sun, cloud, slam, caption, popIn, applyShake, sparkle } from '@engine/style/collage/index.js';
import T from '@project/timeline.js';

export default {
  id: '01-intro',
  start: (T) => T.s1,
  layout: {
    land: { title: [760, 230, 130], box: [1380, 960, 560], cap: [720, 560, 84], sun: [1720, 170], cloud: [420, 150] },
    vert: { title: [630, 430, 104], box: [630, 1760, 700], cap: [630, 760, 78], sun: [1060, 250], cloud: [300, 230] },
    sq: { title: [630, 190, 100], box: [900, 1200, 560], cap: [420, 520, 72], sun: [1130, 150], cloud: [260, 130] },
  },
  sfx: (T) => [
    { t: T.title - 0.08, kind: 'paper', dur: 0.25, vel: 0.2 },
    { t: T.title + 0.02, kind: 'thud', vel: 0.45 },
    { t: T.box, kind: 'pop', vel: 0.26, pitch: 0.9 },
    { t: T.sorted, kind: 'scribble', dur: 0.5, vel: 0.1 },
    { t: T.seconds + 0.2, kind: 'ding', midi: 91, vel: 0.14 },
  ],
  draw(ctx, lt, t, L) {
    applyShake(ctx, t, T.title + 0.18, 0.4, 10);
    backdrop(ctx, 'bg_room', lt, T.s2, { z0: 1.0, zoom: 1.06, fy: 0.45 });
    popIn(ctx, L.sun[0], L.sun[1], pop(t, 0.3, 0.5), (c) => sun(c, 0, 0, 58, { t }));
    cloud(ctx, L.cloud[0] + lt * 14, L.cloud[1], 0.5);
    // product box drops in on "Demo", then bobs
    const k = pop(t, T.box - 0.1, 0.5, 2.4);
    if (k > 0) art(ctx, 'box', L.box[0], L.box[1] + Math.sin(t * 2.2) * 6, L.box[2] * k, { rot: Math.sin(t * 1.3) * 0.03 });
    if (t > T.box + 0.3) sparkle(ctx, L.box[0] + L.box[2] * 0.38, L.box[1] - L.box[2] * 0.9, 26 * ease.outBack(prog(t, T.box + 0.3, T.box + 0.7)), C.yellow, t);
    slam(ctx, 'INTRODUCING!', L.title[0], L.title[1], t, T.title - 0.05, { size: L.title[2], hl: C.cyan });
    caption(ctx, 'sorted in seconds', L.cap[0], L.cap[1], t, T.sorted, { size: L.cap[2], hl: C.yellow, rot: -0.05 });
  },
};
