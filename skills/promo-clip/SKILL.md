---
name: promo-clip
description: Make or continue a short animated promo video — runs every stage in order and resumes where the video left off.
argument-hint: "[what you want, e.g. 'new music for this clip' or 'auto mode']"
disable-model-invocation: true
---

# /promo-clip — the conductor

Runs the stages in order — discover → script → voice → music → art → scenes → formats → export — honouring gates or auto mode, and resumes from `promo.json`. Read `${CLAUDE_PLUGIN_ROOT}/skills/promo-clip/protocol.md` first: it defines the video folder `V`, the CLI, the stage lifecycle and gates.

## 1. Find or create the video folder

- If the current directory or a parent has `promo.json`, that folder is `V`.
- Otherwise ask for a name (and location, default `./<name-slug>` in the current directory), then create it:
  `node "${CLAUDE_PLUGIN_ROOT}/engine/tools/cli.mjs" setup <folder> --name "<name>" --json`
  Setup checks Node, Chrome and ffmpeg and installs the tool packages; if it reports a missing dependency, relay its install hint and stop.

Done when `V/promo.json` exists and `node V/tools/cli.mjs status --project V` prints the stage table.

## 2. Read the request

The user's words after `/promo-clip` can steer the run:

- nothing → resume at the first stage that isn't done.
- a stage to redo ("new music", "rewrite the script", "different voice") → run that stage first; the stages it makes stale follow.
- "auto mode" / "gated mode" → `mode auto|gated` before continuing.
- a budget ("spend at most $5") → `budget 5`.

## 3. Run the stages

Loop:

1. `next --json` → the first stage that is todo, stale, failed or stuck.
2. None left → go to 4.
3. Read `${CLAUDE_PLUGIN_ROOT}/skills/<stage>/SKILL.md` and carry it out completely, gate included, until its `stage <stage> done` is recorded.
4. Back to 1.

Before each stage, tell the user in one line which stage starts and why (todo / stale because …). In auto mode keep going without asking; in gated mode every stage's gate is the pause point.

## 4. Wrap up

Show `status` and `cost`, the MP4 paths in `V/out/` and the QA verdict from `V/out/qa_report.md`. Mention that any stage can be redone later with `/promo-clip:<stage>` or `/promo-clip <what to change>`.
