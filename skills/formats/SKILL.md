---
name: formats
description: Add the other aspect-ratio layouts (16:9, 9:16, 1:1) to every scene of a promo-clip video — in parallel, one agent per scene, or one by one — and proof them.
disable-model-invocation: true
---

# /promo-clip:formats

Read `${CLAUDE_PLUGIN_ROOT}/skills/promo-clip/protocol.md` first, then `${CLAUDE_PLUGIN_ROOT}/skills/promo-craft/layout.md` (design spaces, safe zone, re-composing, `grp`). The scenes stage must be done. `stage formats start`.

Formats to add: every entry of `promo.json` `output.formats` except `output.primary`. With none, gate straight through: nothing to add.

## 1. Baseline

`stills .work/stills/<primary>-before --scenes --format <primary> --size 720p --png` — the primary format must look exactly like this afterwards.

## 2. Adapt the scenes

Same mode choice as the scenes stage (gated: ask; auto: parallel above 4 scenes).

**Parallel.** One Agent call per scene in a single message, `subagent_type: "promo-clip:scene-writer"`:

```
PLUGIN: ${CLAUDE_PLUGIN_ROOT}
V: <absolute video folder>
SCENE: <NN-name>   MODE: adapt   PRIMARY: <format>
Add formats: <vertical, square …>
```

**One by one.** Read `${CLAUDE_PLUGIN_ROOT}/agents/scene-writer.md` and follow it in adapt mode for each scene.

Each adaptation adds only the new layout keys, re-composes for the frame (rows become stacks, groups move with `grp`), keeps text inside the vertical safe zone, and proofs each added format with stills and `layout`.

Done when every scene reports layout errors 0 in every added format.

## 3. Review

1. Primary unchanged: `stills .work/stills/<primary>-after --scenes --format <primary> --size 720p --png`, then `node "${CLAUDE_PLUGIN_ROOT}/tests/pixel-diff.mjs" V/.work/stills/<primary>-after V/.work/stills/<primary>-before`. A failing scene goes back to its writer: restore the primary entry.
2. One `promo-clip:scene-reviewer` with `PLUGIN`, `V`, all formats, round 1; route its requests as in the scenes stage (same agent via SendMessage, else a new writer in fix mode); round 2 at most.

## 4. Gate

`stills .work/stills/<format> --scenes --sheet --format <format> --size 720p` for every format; show one sheet per format and any known issues. Gate per the protocol; change requests go back to 2 for those scenes and formats. Then `stage formats done`.
