# Project Memories

## Status
- Phase 1 (engine extraction) done 2026-10-11 on branch `phase1-engine`. Phases 2–5 (full CLI, plugin skills, scene agents, polish) not started.

## Engine layout and conventions (engine/)
- `engine/js/` = browser engine (ESM, bundled by esbuild into `<video>/promo.bundle.js`, IIFE so file:// works). `engine/tools/` = Node CLI (`cli.mjs build | stills | export`), deps in `engine/tools/node_modules` (run `npm install` there).
- Import aliases (resolved by the esbuild plugin in `tools/build-assets.mjs`): `@engine/<p>` → engine/js, `@project/<p>` → video folder, `@scenes` → generated `.work/build/scenes.js` (every `scenes/*.js`, file-name order, id = file name), `@build/<p>` → `.work/build` (generated media-data.js: FONTS_CSS, VO_B64, MUSIC_B64). This is how the plugin's engine can build a project that has no engine copy (the CI fixture) — the tech design's relative `./timeline-base.js` imports were replaced by these aliases.
- Project = `--project` or nearest folder with promo.json. `serve.mjs` falls back to `engine/index.html` when the project has none.
- Theme: `style/collage/draw.js` imports `@project/theme.json` and merges palette/fonts into `C`/`FONT` at module load (so scene module-level code already sees the theme). `INK` is a live `let`. Use palette keys or CSS colours (`col()`, `alpha()`).
- Formats/sizes: pure `js/formats.js` (`resolveSize(format, size)`); URL `?format=&size=` (preset 720p/1080p/1440p/4K or `WxH`). Custom size → nearest-AR layout, cover-scale, centre-crop; `MAX_CROP = 0.2` total on the cropped axis (10 %/edge) — the design spec's "10 %" can't fit its own 4:5 example (needs 20 %). Render transform = `setTransform(SCALE,0,0,SCALE,-cropX,-cropY)`.
- Sticker layer is sized to the OUTPUT canvas (promo02 sized it to the design space, which would clip stickers above 1080p).
- Scene contract: `export default { start:(T)=>…, layout:{land,vert,sq}, sfx:(T,L)=>[{t, kind, …}], draw(ctx, lt, t, L) }`; scenes import `T` from `@project/timeline.js`. Missing current-format layout falls back to another (warns). SFX kinds listed in `js/audio.js` `SFX`. Transitions declared in timeline.js `TRANSITIONS` (swipe/iris/flash/eyelids, `style/collage/transitions.js`), which also add their own default SFX.
- Pure logic for unit tests: `js/data-core.js` (`makeData`, `wordKey` — Unicode-aware exact match, query normalised too) and `js/formats.js`. `js/package.json` sets `"type":"module"` so Node can import them. Run tests: `node --test tests/unit/*.test.mjs` (Node 24 rejects a bare directory arg).
- `stills --scenes` grabs each scene 0.5 s before its end (past entrances, before the ±0.32 s swipe / 0.45 s closing fade).

## Fixture (fixtures/sample-15s)
- `make-fixture.mjs` regenerates all placeholder assets deterministically: per-word procedural "babble" VO (exact word times, no espeak/STT), 120 BPM procedural loop → `track.mp3` via ffmpeg-static with the final hit placed on "now", sharp-rendered SVG art, QR via `qrcode`. ~15 s, 3 scenes, layouts for all 3 formats.
- Verified 2026-10-11: builds; stills in 3 formats; exports 3 formats × 720p and 1080p (−14 LUFS); 4K vertical and 1080x1350 stills.
