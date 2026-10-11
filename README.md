# promo-clip

Claude Code plugin for short animated promo videos: guided discovery, script, voice-over, music, art,
scenes, format variants and export, in a hand-drawn paper-collage style. **Work in progress** (engine only).

## Engine quick start (development)

```sh
cd engine/tools && npm install          # esbuild, puppeteer-core, ffmpeg-static, sharp, qrcode
cd ../../fixtures/sample-15s
node ../../engine/tools/cli.mjs build
node ../../engine/tools/cli.mjs stills .work/stills --scenes --format vertical --size 720p
node ../../engine/tools/cli.mjs export --format square --size 1080p   # -> out/sample_15s_square_1080p[_web].mp4
```

Needs Node ≥ 20 and Chrome/Chromium (or `CHROME_PATH`). Unit tests: `node --test tests/unit/*.test.mjs`.

## Licence

Code: MIT. Bundled fonts (Orbitron, Inter, Caveat, Permanent Marker): SIL Open Font License.
