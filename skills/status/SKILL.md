---
name: status
description: Show a promo-clip video's stages, next step, budget and spend.
disable-model-invocation: true
---

# /promo-clip:status

Find the video folder `V` as in `${CLAUDE_PLUGIN_ROOT}/skills/promo-clip/protocol.md`, then run and show:

1. `node "${CLAUDE_PLUGIN_ROOT}/engine/tools/cli.mjs" status --project V` — run with the plugin's CLI so it compares the video's engine with the plugin's; on a mismatch, mention `/promo-clip:upgrade`.
2. `node V/tools/cli.mjs cost --project V`

Suggest the next command: `/promo-clip` to continue, or `/promo-clip:<stage>` for a stale or failed stage.
