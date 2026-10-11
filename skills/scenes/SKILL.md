---
name: scenes
description: Write the animated scenes of a promo-clip video for its primary format — in parallel, one agent per scene, or one by one — then review the whole film and proof it with stills.
disable-model-invocation: true
---

# /promo-clip:scenes

Read `${CLAUDE_PLUGIN_ROOT}/skills/promo-clip/protocol.md` first, then from `${CLAUDE_PLUGIN_ROOT}/skills/promo-craft/`: `scene-api.md`, `layout.md`, `timing.md`. A complete small example — timeline plus three scenes in three formats — is `${CLAUDE_PLUGIN_ROOT}/fixtures/sample-15s/`. Voice, music and art must be done. `stage scenes start`.

The **primary format** is `promo.json` `output.primary`; this stage writes only its layout key (`land`, `vert` or `sq`). The formats stage adds the others.

## 1. Timeline — `V/timeline.js`

From `V/script.md` and `V/vo/timing.json` (word list with times; `assets/music/cues.json` `film` has the music's reveal and final hit):

- `T.s1 = 0`, and for every later scene `T.sN = sceneStart('<its first word>', nth)`.
- One named event per beat a picture idea needs (`T.logo = W('demoproduct', 1)`, `T.stamp = onBeat(W('now'))`, `T.final = HIT.final`). Names describe the beat, not the word.
- `TRANSITIONS`: a `swipe` on most cuts (alternate `dir`, palette colours), an `iris` on the reveal, a `flash` on a camera-shutter moment, `eyelids` for a blink.

## 2. Placeholders

For every `## NN-name` in the script without a scene file yet, write `V/scenes/NN-name.js`:

```js
export default { placeholder: true, start: (T) => T.sN, layout: { <primary key>: {} }, draw() {} };
```

`placeholder: true` marks the file as unwritten (QA fails on it); a writer replaces the whole file. Then `build`. Done when it succeeds — every scene now has its correct start and end, so writers can work in any order (a word missing from timing.json throws with its name: fix the word or its `nth`).

## 3. Write the scenes

**Choose the mode.** Parallel = one `scene-writer` agent per scene, all at once. Gated mode: ask "write N scenes in parallel (N agents) or one by one?". Auto mode: parallel when the film has more than 4 scenes, else one by one. Scenes being redone after a review or a change request follow the same choice.

**Parallel preflight.** Agents run in the background and cannot ask the user for permission, so they only work when the session lets them write files and run the CLI. Before the first parallel dispatch of the session, send one `general-purpose` agent: "Write the file `V/.work/agent-check.txt` containing `ok` with the Write tool, then run `node V/tools/cli.mjs status --project V --json` as a single Bash command; report which calls were denied." If either was denied, tell the user once — parallel scene writing needs Claude Code in accept-edits mode (Shift+Tab, or `"defaultMode": "acceptEdits"` in settings) and an allow rule for the CLI, e.g. in `.claude/settings.local.json`:

```json
{ "permissions": { "defaultMode": "acceptEdits", "allow": ["Bash(node *)"] } }
```

— and continue one by one (gated mode: ask whether they want to change it and retry first).

**Parallel.** Send one Agent call per scene in a single message (so they run concurrently), `subagent_type: "promo-clip:scene-writer"`, each prompt carrying:

```
PLUGIN: ${CLAUDE_PLUGIN_ROOT}
V: <absolute video folder>
SCENE: <NN-name>   MODE: write   PRIMARY: <landscape|vertical|square>
Lines: <the scene's > lines, tags removed>
Picture: <its Picture: idea>
Events: <the T.* names and their words this scene uses, e.g. T.s3 (cut, "speed"), T.stuck ("only" #2)>
Art keys: <manifest keys meant for this scene, plus shared ones such as the logo, qr>
Tone: <one line from the brief>
```

Each writer edits only its own file, renders with its own private build (`--tag`), and reports its beats, still paths and layout result.

**One by one.** Read `${CLAUDE_PLUGIN_ROOT}/agents/scene-writer.md` and follow it yourself for each scene in film order (the shared build is fine here; `--tag` is optional).

Done when every scene has a writer report (or your own equivalent) and `layout --format <primary>` reports 0 errors for the whole film — it fails on any scene still left as a placeholder.

## 4. Review

Dispatch one `subagent_type: "promo-clip:scene-reviewer"` with `PLUGIN`, `V`, formats `<primary>`, round 1. It returns `ship` or `fix` plus per-scene requests and film-level notes.

- Film-level notes (timeline events, transitions) are yours: edit `timeline.js`.
- Scene requests go back to that scene's writer: continue the same agent with SendMessage when it is still reachable, else dispatch a new `scene-writer` with `MODE: fix` and the requests. Fixes for different scenes run in parallel.
- Then round 2 of the review. After round 2, stop iterating: carry any remaining `must` items into the gate as known issues.

## 5. Gate

`stills .work/stills/<primary> --scenes --sheet --format <primary> --size 720p`, then show `sheet.jpg` and, per scene, what happens on which words (from the writers' reports), plus any known issues. Gate per the protocol; change requests go back to 3 for those scenes (fix mode). Then `stage scenes done` (formats and export go stale).
