---
name: formats
description: Add the other aspect-ratio layouts (16:9, 9:16, 1:1) to every scene of a promo-clip video and proof them.
disable-model-invocation: true
---

# /promo-clip:formats

Read `${CLAUDE_PLUGIN_ROOT}/skills/promo-clip/protocol.md` first, then `${CLAUDE_PLUGIN_ROOT}/skills/promo-craft/layout.md` (design spaces, safe zone, stacking patterns, `grp`). The scenes stage must be done. `stage formats start`.

Formats to add: every entry of `promo.json` `output.formats` except `output.primary`. With none, gate straight through: nothing to add.

## 1. Adapt each scene

For each scene and each format to add: add its key (`land` / `vert` / `sq`) to the scene's `layout`, leaving the primary entry exactly as it is. Re-compose for the frame rather than scale: landscape rows become vertical stacks; groups that move together keep their primary coordinates inside a `grp` transform. Text stays inside the vertical safe zone.

## 2. Proof each format

1. `build`
2. `stills .work/stills/<format> --scenes --sheet --format <format> --size 720p`, plus mid-scene stills at the main events.
3. Read the stills; `layout --format <format>`.
4. Fix and repeat, at most 3 rounds per scene.
5. The primary format must not change: `stills .work/stills/<primary>-check --scenes --format <primary> --size 720p --png` and compare with the scenes stage's stills by eye, or with `node "${CLAUDE_PLUGIN_ROOT}/tests/pixel-diff.mjs" <new dir> <old dir>` when both are PNG.

Done when every format has a clean sheet and `layout` reports no errors in any format.

## 3. Gate

One sheet per format (`.work/stills/<format>/sheet.jpg`). Gate per the protocol; change requests go back to 1 for those scenes and formats. Then `stage formats done`.
