---
name: upgrade
description: Update a promo-clip video's engine copy to the plugin's current engine and compare the scenes before and after.
disable-model-invocation: true
---

# /promo-clip:upgrade

Read `${CLAUDE_PLUGIN_ROOT}/skills/promo-clip/protocol.md` first. A video keeps its own engine copy so it never breaks when the plugin changes; this stage pulls in the plugin's engine on request.

1. Compare versions: `node "${CLAUDE_PLUGIN_ROOT}/engine/tools/cli.mjs" status --project V --json` → `engine` (the video's) vs `toolsEngine` (the plugin's). Equal → nothing to do; say so and stop.
2. Before: `node V/tools/cli.mjs stills V/.work/upgrade/before --scenes --format <primary> --size 720p --png --project V`.
3. Upgrade: `node "${CLAUDE_PLUGIN_ROOT}/engine/tools/cli.mjs" upgrade --project V` — replaces `js/`, `tools/`, `index.html`, `VERSION` and the bundled fonts; keeps scenes, timeline, theme, manifest, providers.json and assets; marks scenes stale; the old engine is kept in `V/.work/engine-<old version>/`.
4. After: the same stills command into `V/.work/upgrade/after` (now with the new engine).
5. Compare: `node "${CLAUDE_PLUGIN_ROOT}/tests/pixel-diff.mjs" V/.work/upgrade/after V/.work/upgrade/before --out V/.work/upgrade/diff`. Read the stills that differ.

Report: old → new version, which scenes changed and how they look. If a scene broke (it throws in `build`, or a still is clearly wrong), show the error and offer to fix the scene, or to roll back: copy `V/.work/engine-<old>/js`, `tools` (keep `tools/node_modules`), `index.html` and `VERSION` back and set `promo.json` `engine` to the old version. `/promo-clip` then re-runs the stale stages (scenes → formats → export).
