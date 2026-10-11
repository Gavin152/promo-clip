// 03 end card: "Get Demo Product now." Logo, tagline, QR + website; flash on the final music hit.
import { prog, ease, pop } from '@engine/util.js';
import { C, fill, sunburst, logo, caption, img, text, popIn, confetti, glow } from '@engine/style/collage/index.js';
import THEME from '@project/theme.json';
import T from '@project/timeline.js';

export default {
  id: '03-end',
  start: (T) => T.s3,
  layout: {
    land: { logo: [960, 330, 150], tag: [960, 520, 72], qr: [960, 790, 300], site: [960, 1000, 44] },
    vert: { logo: [630, 640, 104], tag: [630, 860, 72], qr: [630, 1270, 460], site: [630, 1620, 52] },
    sq: { logo: [630, 280, 104], tag: [630, 450, 64], qr: [630, 790, 380], site: [630, 1110, 46] },
  },
  sfx: (T) => [
    { t: T.logo, kind: 'arp', notes: [74, 78, 81, 86], gap: 0.07, vel: 0.08 },
    { t: T.final - 0.01, kind: 'shutter', vel: 0.5 },
    { t: T.qr, kind: 'pop', vel: 0.2, pitch: 1 },
  ],
  draw(ctx, lt, t, L) {
    fill(ctx, C.navy);
    sunburst(ctx, L.logo[0], L.logo[1], t, ease.outCubic(prog(t, T.s3, T.s3 + 0.6)));
    glow(ctx, L.logo[0], L.logo[1], 520, 'orange', 0.22);
    logo(ctx, L.logo[0], L.logo[1], L.logo[2], { p: prog(t, T.logo - 0.1, T.logo + 0.5) });
    caption(ctx, THEME.endCard?.tagline ?? '', L.tag[0], L.tag[1], t, T.now - 0.2, { size: L.tag[2], hl: C.orange, rot: -0.02 });
    const [qx, qy, qw] = L.qr;
    popIn(ctx, qx, qy, pop(t, T.qr, 0.5), (c) => img(c, 'qr', 0, 0, qw, { sticker: true, border: 12, rot: 0.03 }));
    if (t > T.qr + 0.2) text(ctx, THEME.endCard?.website ?? '', L.site[0], L.site[1], { font: 'inter', weight: 700, size: L.site[2], color: '#FFFFFF', reveal: prog(t, T.qr + 0.2, T.qr + 0.7), wobble: 0 });
    confetti(ctx, L.logo[0], L.logo[1] + 80, t - T.final, 50, 7);
  },
};
