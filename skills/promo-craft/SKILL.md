---
name: promo-craft
description: Craft reference for promo-clip videos — the scene API, per-format layout, word-timed events, AI provider quirks, QA thresholds and theme fields. Use when writing or reviewing a promo-clip timeline.js or scene, adapting a scene to another aspect ratio, writing a voice-over script, prompting TTS/music/image models for a promo, setting up theme.json, or fixing a promo-clip QA finding.
---

# promo-craft

Reference for building promo-clip videos. Read the file the task needs:

| file | read when |
|---|---|
| [scene-api.md](scene-api.md) | writing or changing `timeline.js` or `scenes/*.js`: imports, the scene contract, every drawing, timing, sound and transition function |
| [layout.md](layout.md) | placing anything on screen, adding a format, fixing clipping or safe-zone errors |
| [timing.md](timing.md) | writing the script, the timeline, or deciding when something appears |
| [providers.md](providers.md) | generating or ranking voice, music or images |
| [qa.md](qa.md) | interpreting or fixing a QA result |
| [theme.md](theme.md) | writing `theme.json`: palette roles, fonts, logo, end card |

A complete small video to copy patterns from: `${CLAUDE_PLUGIN_ROOT}/fixtures/sample-15s/` (`timeline.js`, `scenes/01-intro.js`, `02-feature.js`, `03-end.js`).
