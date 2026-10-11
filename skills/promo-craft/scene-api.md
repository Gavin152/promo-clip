# Scene API

How a scene module is written and what it can draw with. The source is the authority for option details: each function's comment in the video's `js/style/collage/*.js`, `js/util.js`, `js/timeline-base.js`.

## Imports

Scenes and `timeline.js` import through aliases the build resolves:

```js
import { prog, ease, pop, lerp, pick, grp, hash, rng } from '@engine/util.js';
import { C, text, caption, slam, art, backdrop, phone, sticker, popIn } from '@engine/style/collage/index.js';
import T from '@project/timeline.js';          // named story events (film seconds)
import THEME from '@project/theme.json';        // constants, endCard, logo …
```

`timeline.js` itself imports `@engine/timeline-base.js` (`W`, `WE`, `Wa`, `S`, `HIT`, `onBeat`, `accent`, `beatFrom`, `BEAT`, `DURATION`, `sceneStart`).

## The scene contract

```js
export default {
  start: (T) => T.s3,                         // film seconds; the scene ends where the next one starts
  layout: {
    land: { title: [960, 200, 120], hero: [1400, 980, 620] },   // 1920 x 1080
    vert: { title: [630, 420, 100], hero: [630, 1700, 760] },   // 1260 x 2240
    sq:   { title: [630, 180, 96],  hero: [900, 1200, 560] },   // 1260 x 1260
  },
  sfx: (T, L) => [{ t: T.title, kind: 'thud', vel: 0.45 }],
  draw(ctx, lt, t, L) { … },                  // lt = seconds since scene start, t = film time, L = layout for this format
};
```

- The id is the file name (`scenes/03-dashboard.js` → `03-dashboard`); file-name order is film order.
- **Every position and size lives in `layout`** as numbers or small arrays; `draw` reads `L.*`. A missing format falls back to another layout with a warning (that is what the formats stage fills in).
- Everything is a pure function of `t`: the same `t` must draw the same frame. Randomness comes from `hash(…)`, `hs(…)` or `rng(seed)`, never `Math.random`.
- `ctx` is already in design units for the current format (`W` x `H` from `@engine/util.js`); scale and crop to the output size happen outside the scene.
- Images are drawn by **manifest key** (`manifest.json`), never by path.

## Timing helpers (`@engine/util.js`)

| | |
|---|---|
| `prog(t, a, b)` | 0..1 progress of t from a to b (clamped) |
| `ease.outBack / outCubic / inOutSine / inBack / outElastic …` | easings; `ease.outBack(0) === 0` exactly |
| `pop(t, t0, dur=0.45, s=2.2)` | 0 → overshoot → 1 scale for an entrance at t0 |
| `unpop(t, t0, dur=0.3)` | 1 → 0 exit |
| `env(t, a, b, fin, fout)` | fade-in/out envelope |
| `lerp`, `clamp`, `hash`, `hs`, `rng`, `noise1` | maths; deterministic noise |
| `pick(land, vert, sq=vert)` | per-format value (prefer `layout`) |
| `grp(ctx, [dx, dy, s], fn)` | draw fn with primary-format coordinates moved/scaled as a group |

## Collage style (`@engine/style/collage/index.js`)

**Text and titles**
- `text(ctx, str, x, y, {font:'hand'|'marker'|'display'|'inter', size, color, align, weight, reveal, wobble, stroke, strokeW, spacing})` — hand-wobbled letters; `reveal` 0..1 types it on.
- `caption(ctx, str, x, y, t, t0, {size, font, hl, color, rot, align, scale})` — sticker caption written on from t0; `hl` = marker highlight colour.
- `slam(ctx, str, x, y, t, t0, {size, hl, color, rot})` — title that slams in at t0.
- `highlight`, `underline`, `arrow`, `sparkle`, `measure(ctx, str, o)`.

**Shapes and paper**
- `shape(ctx, pts, {fill, stroke, lw, hatch, closed, amp})`, `stroke`, `circle`; point helpers `rrect`, `ell`, `line`, `quad`, `bez`, `resample`, `partial(pts, p)` (draw-on).
- `sticker(ctx, fn, {border, shadow})` — draws `fn(c)` twice (white backing pass, then colour); `fn` must be side-effect free.
- `torn(ctx, pts, color, o)`, `tornRectPts(x, y, w, h, seed)`, `waveStrip(ctx, y, color, {amp, wl, phase})`, `tornImage(ctx, key, x, y, w, h, seed)`.

**Images**
- `art(ctx, key, x, y, h, {rot, flip, alpha, ax=0.5, ay=1})` — die-cut cut-out, anchored **bottom-centre** (characters stand on y).
- `backdrop(ctx, key, lt, dur, {z0, zoom, fx, fy, dx, dy})` — full-frame cover-fit with a slow push-in; `fx/fy` = focus point 0..1.
- `img(ctx, key, x, y, w, {rot, sticker, border, radius})` — centred image (QR, badges, screenshots).
- `phone(ctx, cx, cy, h, screenKeyOrFn, {rot, overlay(c, sx, sy, sw, sh)})`, `polaroid(ctx, x, y, w, contentFn(c, w, h), caption, {rot, key})`, `laptop`, `frame`.
- `logo(ctx, x, y, size, {p})` — the theme logo (text or image), `p` types it on.

**Props drawn in code** — `sun(ctx, x, y, r, {shades})`, `moon`, `cloud(ctx, x, y, s)`, `gull`, `island`, `compass`, `route`, `mapArrow(ctx, x, y, ang, color, s, label)`, `bubble(ctx, x, y, w, h, [tailDx, tailDy], str)`, `wifiIcon`, `checkMark(ctx, x, y, s, p)`, `xMark`, `stopwatch`, `creditCard`, `keypad`, `gear`, `trophy`, `padlock`, `chain`, `couch`, `statsPanel(ctx, x, y, s, vals, {labels, units, colors})`, `premiumBadge(ctx, x, y, s, {label})`, `priceTag(ctx, x, y, s, {price, label})`, `stamp(ctx, x, y, str, {p, color, size, rot})`, `confetti(ctx, x, y, t - t0, n, seed)`.

**People** — `person(ctx, x, y, {look, s, ...POSE.cheer, mouth, eyes, brow, face, walk, sit, flip, phone:'L'|'R'})` stick figures with feet at (x, y). `LOOKS` (casual (default), cap, blonde, brown, mom, kid1, kid2, grandpa + theme `characters`), `POSE` (idle, hips, shrug, cheer, phoneR, phoneL, point, thumbs), `wave(t)` for a waving arm.

**Scene helpers** — `fill(ctx, color)`, `gridPaper(ctx, bg, line, step)`, `corkBoard`, `sunburst(ctx, x, y, t, a, color)`, `glow(ctx, x, y, r, color, a)`, `doodleStars`, `waveDoodles`, `camera(ctx, lt, dur, zoom)` (handheld drift + push-in), `applyShake(ctx, t, t0, dur, amp)`, `popIn(ctx, x, y, k, fn, rot)`, `rise(t, t0)`, `beatPulse(t)`, `breathe(t, seed)`, `dataTag(ctx, x, y, label, value, unit, k, rot, color)`, `pin`, `alpha(color, a)`, `mixColor(a, b, k)`.

**Colours** — `C.<role>` (see `theme.md`) or palette keys as strings where an option takes a colour.

## Sound (`sfx`)

`sfx(T, L)` returns `{ t, kind, …params }` cues. Kinds: `whoosh {dur, vel, dir}`, `pop {vel, pitch}`, `paper {dur, vel}`, `thud {vel}`, `shutter {vel}`, `ding {midi, vel}`, `arp {notes, gap, vel}`, `scribble {dur, vel}`, `buzz`, `boing`, `gull`, `waves {to, vel}`, `coins`, `crash {vel, len}`, `riser {to, vel}`, `glock {midi, vel}`, `noise {f, q, type, vel, decay, len}`. Keep `vel` 0.1–0.5; sounds sit under the voice. Transitions add their own swipe sounds.

## Transitions (in `timeline.js`)

```js
export const TRANSITIONS = [
  { t: T.s2, type: 'swipe', color: 'navy2', dir: 1 },          // torn sheet across the cut
  { t: T.s5, type: 'iris', color: 'accent', x: 960, y: 560 },    // paper ring bursts open
  { t: T.final, type: 'flash' },                               // white flash
  { type: 'eyelids', close: T.blink, shut: T.blinkEnd, open: T.s2 },
];
```

The film always fades to dark over its last 0.45 s.
