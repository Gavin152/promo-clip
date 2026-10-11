# Writing scenes

This covers the project layout and how to hand-write or edit scene files. For a full API reference see [`skills/promo-craft/scene-api.md`](../skills/promo-craft/scene-api.md).

---

## Video folder layout

```
V/
  promo.json           state: stages, gates, mode, budget, output
  brief.md             discovery answers
  script.md            per-scene script (## NN-name sections, > spoken lines)
  theme.json           palette, fonts, logo, end card, brand words, constants
  manifest.json        image key → file path (kept current by `art manifest`)
  timeline.js          all named story events (film seconds)
  scenes/
    01-intro.js
    02-feature.js
    03-end.js
  assets/
    vo/                vo.wav, timing.json, no-gaps pair
    music/             track.mp3, cues.json
    art/               die-cut PNGs and backdrops (raw/ for originals)
    img/               flat images (QR, badges, screenshots)
    ref/               reference photos used in art generation
  .work/               scratch renders and stills (git-ignored)
  out/                 final MP4s and QA report
```

Every `scenes/*.js` file is picked up automatically; scenes play in order of their `start` time. A scene's `id` is its file name without `.js` (if you set `id` yourself, keep it equal to the file name).

---

## `timeline.js`

`timeline.js` exports a plain object `T` of story events (film times in seconds), derived from word times and music cues. It also exports `TRANSITIONS`.

```js
import { W, WE, Wa, HIT, onBeat, sceneStart } from '@engine/timeline-base.js';

const T = {};

// scene 1 starts at t=0
T.s1 = 0;

// W('word') = film time of the first occurrence of that word
T.title   = W('introducing');
T.logo    = W('widget', 1);   // second occurrence (nth is 0-based)

// scene 2 starts 0.3 s before the word 'try' (the CUT_PAD default)
T.s2 = sceneStart('try');

// snap to a beat if one is within 0.15 s of the word 'works'
T.beat  = onBeat(W('works'));

// the music's final hit
T.final = HIT.final;

// WE = end of a word; Wa = first occurrence at or after a time
T.qr   = WE('now') + 0.2;
T.tap2 = Wa('tap', T.s2);

export default T;

export const TRANSITIONS = [
  { t: T.s2, type: 'swipe', color: 'navy2', dir: 1 },
  { t: T.s3, type: 'swipe', color: 'orange', dir: -1 },
  { t: T.final, type: 'flash', dur: 0.35 },
];
```

### Timing helpers

| Export | What it returns |
|---|---|
| `W(word, nth=0)` | film start time of the nth occurrence of `word` (0-based) |
| `WE(word, nth=0)` | film end time of that occurrence |
| `Wa(word, after)` | start of the first occurrence at or after film time `after` |
| `S(phrase)` | film start of the sentence that contains `phrase` |
| `HIT` | music hits from `cues.json` (`HIT.final` = the closing hit) |
| `onBeat(t, tol=0.15)` | the nearest beat if one is within `tol` seconds, else `t` |
| `sceneStart(word, nth, pad)` | `W(word, nth) - pad` (default pad = 0.3 s) |
| `BEAT` | beat duration (seconds) |
| `DURATION` | total film duration (seconds) |

All times are film seconds and already include the VO start offset and any widened pauses. Word matching is exact (never a prefix: `W('no')` does not match "now"), Unicode-aware and case-insensitive. An unknown word throws with its name at build time. Set `theme.json` `spoken` to map regex patterns when a spoken form differs from the script.

### Transitions

| Type | Required fields | Optional fields |
|---|---|---|
| `swipe` | `t`, `color` | `dir` (1 = left-to-right, -1 = right-to-left), torn paper sheet |
| `iris` | `t`, `color` | `x`, `y` (origin, design units) |
| `flash` | `t` | `dur` |
| `eyelids` | `close`, `shut`, `open` | — |

Transitions add their own SFX automatically. The film always fades to black over its last 0.45 s.

---

## The scene contract

Every `scenes/NN-name.js` is an ES module with a single default export:

```js
export default {
  start: (T) => T.s1,            // film seconds where this scene starts
  layout: {
    land: { … },                 // positions for 16:9 landscape (1920 x 1080)
    vert: { … },                 // positions for 9:16 vertical  (1260 x 2240)
    sq:   { … },                 // positions for 1:1 square     (1260 x 1260)
  },
  sfx: (T, L) => [               // SFX cues; L = layout for the current format
    { t: T.title, kind: 'thud', vel: 0.45 },
  ],
  draw(ctx, lt, t, L) {          // called every frame
    // lt = seconds since scene start, t = film time, L = layout for this format
  },
};
```

Rules:

- The scene ends where the next scene's `start` is.
- A missing format falls back to another layout with a console warning. The formats stage fills in the missing ones.
- `draw` must be a pure function of `t`. The same `t` must produce the same frame. Use `hash(…)`, `hs(…)` or `rng(seed)`, never `Math.random`.
- `ctx` is already in design units (`W` × `H` for the current format). Scale and crop to the output size happen outside the scene.
- Images are drawn by manifest key (from `manifest.json`), never by path.

---

## Layout objects per format

Design spaces:

| Format | Layout key | Design space |
|---|---|---|
| 16:9 landscape | `land` | 1920 × 1080 |
| 9:16 vertical | `vert` | 1260 × 2240 |
| 1:1 square | `sq` | 1260 × 1260 |

Layout values are numbers or small arrays of numbers. Convention: `[x, y, size]` for positioned elements. `draw` reads `L.title`, `L.hero`, etc. and never hard-codes coordinates.

Example layout block:

```js
layout: {
  land: { title: [960, 220, 120], hero: [1400, 980, 620] },
  vert: { title: [630, 420, 96],  hero: [630, 1700, 760] },
  sq:   { title: [630, 200, 88],  hero: [900, 1200, 560] },
},
```

### Safe zone

Vertical format only: **text must stay within y 250–1750** (platform UI covers top and bottom in Reels/TikTok/Shorts). Decorative stickers and backdrops may bleed past it. `layout` exits with code 2 on safe-zone violations.

### Minimum readable sizes (design units)

| Element | Landscape | Vertical / Square |
|---|---|---|
| Titles (`slam`) | 100 | 100 |
| Captions | 56 | 64 |
| Data values | 48 | 48 |
| Small labels | 26 | 26 |
| Characters | 450 tall | 600 tall |
| QR code | 260 wide | 380 wide |

---

## `pick` and `grp`

`pick(land, vert, sq=vert)` returns the value for the current format. Use it when one number differs by format but does not belong in `layout`:

```js
import { pick } from '@engine/util.js';
const fontSize = pick(96, 80);  // 96 in landscape, 80 in vertical and square
```

`grp(ctx, [dx, dy, s], fn)` draws `fn` with primary-format coordinates shifted and scaled as a group. Store `[dx, dy, s]` in `layout` so the formats stage can adjust the whole group in one entry:

```js
layout: {
  land: { chart: [1400, 540, 1.0] },
  vert: { chart: [630, 1200, 0.9] },
  sq:   { chart: [630, 800, 0.85] },
},

draw(ctx, lt, t, L) {
  grp(ctx, L.chart, (c) => {
    // draw the chart in its primary-format coordinates
  });
}
```

---

## Style API overview

Full details are in [`skills/promo-craft/scene-api.md`](../skills/promo-craft/scene-api.md). The main imports:

```js
import { prog, ease, pop, unpop, env, lerp, clamp, hash, hs, rng, noise1, pick, grp } from '@engine/util.js';
import { C, text, caption, slam, art, backdrop, phone, sticker, popIn, rise, beatPulse,
         fill, gridPaper, shape, circle, torn, waveStrip, img, logo,
         sun, cloud, person, confetti, sparkle, applyShake } from '@engine/style/collage/index.js';
import T from '@project/timeline.js';
import THEME from '@project/theme.json';
```

**Colours.** Use `C.<role>` for palette roles (e.g. `C.cyan`, `C.navy`, `C.paper`) or any CSS hex string. Theme palette keys are merged into `C` at module load.

**Entrance animations.** `pop(t, t0, dur=0.45)` → 0 → overshoot → 1 scale. `rise(t, t0)` → 0..1 linear. `unpop(t, t0)` → exit. Gate draws on `k > 0` (not `k >= 0`): `ease.outBack` and `pop` return exact 0 before their start time.

**Text.** `slam(ctx, str, x, y, t, t0, {size, hl})` — slams in at t0. `caption(ctx, str, x, y, t, t0, {size, hl, rot})` — writes on from t0. `text(ctx, str, x, y, {font, size, color, reveal})` — hand-wobbled, `reveal` 0..1 types it on.

**Images.** `art(ctx, key, x, y, h, {rot, flip})` — die-cut, anchored bottom-centre (y is the foot). `backdrop(ctx, key, lt, dur, {z0, zoom, fx, fy})` — full-frame cover-fit with slow push-in. `img(ctx, key, x, y, w, {sticker, border})` — centred flat image.

**Determinism.** `hash(…numbers)` → [0,1). `hs(…numbers)` → [-1,1). `rng(seed)` → seeded PRNG. Never use `Math.random`.

---

## SFX kinds

`sfx(T, L)` returns an array of cue objects. Each has `t` (film time) and `kind`. All other parameters are optional.

| Kind | Key parameters |
|---|---|
| `whoosh` | `dur`, `vel`, `dir` (1 or -1) |
| `pop` | `vel`, `pitch` |
| `paper` | `dur`, `vel` |
| `thud` | `vel` |
| `shutter` | `vel` |
| `ding` | `midi`, `vel` |
| `arp` | `notes` (array of MIDI), `gap`, `vel` |
| `scribble` | `dur`, `vel` |
| `buzz` | `vel` |
| `boing` | `vel` |
| `gull` | `vel` |
| `waves` | `to`, `vel` |
| `coins` | — |
| `crash` | `vel`, `len` |
| `riser` | `to`, `vel` |
| `glock` | `midi`, `vel` |
| `noise` | `f`, `q`, `type`, `vel`, `decay`, `len`, `pan` |

Keep `vel` in the range 0.1–0.5. SFX sit under the voice-over; too-loud cues muddy the mix.

---

## Build, stills and layout commands

```bash
# bundle all scenes (required before stills/export)
node V/tools/cli.mjs build --project V

# one labelled stills sheet per format (useful for review)
node V/tools/cli.mjs stills V/.work/stills --scenes --sheet --project V

# stills at specific times
node V/tools/cli.mjs stills V/.work/stills 0 3.5 8 --project V

# lossless PNG stills instead of JPEG
node V/tools/cli.mjs stills V/.work/stills 0 --png=true --project V

# stills at a specific format and size
node V/tools/cli.mjs stills V/.work/stills --scenes --format vertical --size 4K --project V

# layout check (overlaps, clipping, safe-zone violations) — exit 2 on errors
node V/tools/cli.mjs layout --project V
node V/tools/cli.mjs layout --format vertical --project V

# private build for one scene (used by parallel scene agents)
node V/tools/cli.mjs build --tag 02-feature --scene 02-feature --project V
node V/tools/cli.mjs stills V/.work/stills --scenes --tag 02-feature --scene 02-feature --project V
node V/tools/cli.mjs layout --tag 02-feature --scene 02-feature --project V
```

The `--tag` / `--scene` pair writes a private bundle under `.work/build-<tag>/` so parallel agents do not clobber each other's build.

---

## `theme.json`

`theme.json` controls palette, fonts, logo, end card and project-level constants. It is loaded into `C` (palette) and `FONT` at module initialisation; scene module-level code already sees the full theme.

Key fields:

| Field | Type | Purpose |
|---|---|---|
| `palette` | `{ key: "#hex" }` | colour roles; `C.key` in scenes |
| `fonts` | `{ marker, hand, orb, inter }` | CSS font stacks |
| `logo` | `{ type: "text"|"image", text, accent, color }` | drawn by `logo()` |
| `endCard` | `{ qrUrl, website, tagline, badges }` | end-card data read by scenes |
| `brandWords` | `string[]` | STT hint for proper nouns |
| `spoken` | `{ "<regex>": "<form>" }` | map spoken forms to canonical words for word timing |
| `constants` | any | project-specific data scenes can read from `THEME.constants` |

Palette role names used by the collage style: `ink`, `navy`, `navy2`, `surface`, `cyan`, `teal`, `paper`, `kraft`, `cream`, `sky`, `sun`, `orange`, `coral`, `lime`, `red`, `yellow`, `green`.

---

## Complete short example scene

The following scene is adapted from `fixtures/sample-15s/scenes/01-intro.js`. Drop it into a copy of the fixture as `scenes/01-intro.js` and it builds as is.

```js
// 01-intro: "Introducing Demo Product. Your week, sorted in seconds."
import { prog, ease, pop } from '@engine/util.js';
import { C, backdrop, art, sun, cloud, slam, caption, popIn, applyShake, sparkle } from '@engine/style/collage/index.js';
import T from '@project/timeline.js';

export default {
  id: '01-intro',
  start: (T) => T.s1,
  layout: {
    land: { title: [760, 230, 130], box: [1380, 960, 560], cap: [720, 560, 84], sun: [1720, 170], cloud: [420, 150] },
    vert: { title: [630, 430, 104], box: [630, 1760, 700], cap: [630, 760, 78], sun: [1060, 250], cloud: [300, 230] },
    sq:   { title: [630, 190, 100], box: [900, 1200, 560], cap: [420, 520, 72], sun: [1130, 150], cloud: [260, 130] },
  },
  sfx: (T) => [
    { t: T.title - 0.08, kind: 'paper', dur: 0.25, vel: 0.2 },
    { t: T.title + 0.02, kind: 'thud',  vel: 0.45 },
    { t: T.box,          kind: 'pop',   vel: 0.26, pitch: 0.9 },
    { t: T.sorted,       kind: 'scribble', dur: 0.5, vel: 0.1 },
    { t: T.seconds + 0.2, kind: 'ding', midi: 91, vel: 0.14 },
  ],
  draw(ctx, lt, t, L) {
    // camera shake on slam
    applyShake(ctx, t, T.title + 0.18, 0.4, 10);
    // full-bleed backdrop with slow push-in
    backdrop(ctx, 'bg_room', lt, T.s2, { z0: 1.0, zoom: 1.06, fy: 0.45 });
    // decorative elements
    popIn(ctx, L.sun[0], L.sun[1], pop(t, 0.3, 0.5), (c) => sun(c, 0, 0, 58, { t }));
    cloud(ctx, L.cloud[0] + lt * 14, L.cloud[1], 0.5);
    // product box drops in on the word "demo", then bobs gently
    const k = pop(t, T.box - 0.1, 0.5, 2.4);
    if (k > 0) art(ctx, 'box', L.box[0], L.box[1] + Math.sin(t * 2.2) * 6, L.box[2] * k, {
      rot: Math.sin(t * 1.3) * 0.03,
    });
    if (t > T.box + 0.3)
      sparkle(ctx, L.box[0] + L.box[2] * 0.38, L.box[1] - L.box[2] * 0.9,
        26 * ease.outBack(prog(t, T.box + 0.3, T.box + 0.7)), C.yellow, t);
    // title slams in on the word "introducing"
    slam(ctx, 'INTRODUCING!', L.title[0], L.title[1], t, T.title - 0.05, {
      size: L.title[2], hl: C.cyan,
    });
    // caption writes on at "sorted"
    caption(ctx, 'sorted in seconds', L.cap[0], L.cap[1], t, T.sorted, {
      size: L.cap[2], hl: C.yellow, rot: -0.05,
    });
  },
};
```

`T.title`, `T.box`, `T.sorted` and `T.seconds` are word-time events defined in `timeline.js`. `bg_room` and `box` are manifest keys pointing to files in `assets/art/`.
