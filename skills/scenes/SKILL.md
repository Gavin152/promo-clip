---
name: scenes
description: Write the animated scenes of a promo-clip video for its primary format, timed to the voice-over and music, and proof them with stills.
disable-model-invocation: true
---

# /promo-clip:scenes

Read `${CLAUDE_PLUGIN_ROOT}/skills/promo-clip/protocol.md` first, then from `${CLAUDE_PLUGIN_ROOT}/skills/promo-craft/`: `scene-api.md`, `layout.md`, `timing.md`. A complete small example — timeline plus three scenes in three formats — is `${CLAUDE_PLUGIN_ROOT}/fixtures/sample-15s/` (`timeline.js`, `scenes/*.js`). Voice, music and art must be done. `stage scenes start`.

The **primary format** is `promo.json` `output.primary`; this stage writes only its layout key (`land`, `vert` or `sq`). The formats stage adds the others.

## 1. Timeline — `V/timeline.js`

From `V/script.md` and `V/vo/timing.json` (word list with times; `music/cues.json` `film` has the music's reveal and final hit):

- `T.s1 = 0`, and for every later scene `T.sN = sceneStart('<its first word>', nth)`.
- One named event per beat a picture idea needs (`T.logo = W('demoproduct', 1)`, `T.stamp = onBeat(W('now'))`, `T.final = HIT.final`). Names describe the beat, not the word.
- `TRANSITIONS`: a `swipe` on most cuts (alternate `dir`, palette colours), an `iris` on the reveal, a `flash` on a camera-shutter moment, `eyelids` for a blink.

Done when `build` succeeds (a word missing from timing.json throws with its name — fix the word or its `nth`).

## 2. Scenes — `V/scenes/NN-name.js`, one per `## NN-name` in the script

For each scene, in order: write the module per the scene contract (`scene-api.md`) with a `layout` holding only the primary key; every position and size lives in `layout`; everything that appears is timed by a `T` event; `sfx` gives each entrance its sound. Give each scene its own composition and background — vary backdrops, grid paper, solid colour fields, camera moves.

Then proof it:

1. `build`
2. `stills .work/stills/<primary> --scenes --sheet --format <primary> --size 720p` → one still per scene at its final state + `sheet.jpg`; plus `stills .work/stills/<primary>/beats <t …> --format <primary> --size 720p` at the scene's main events to see entrances mid-way.
3. Read the stills. Look for: text cut off or crossing the frame edge, elements covering each other's text, empty halves of the frame, sizes too small to read at phone size, art floating where it should stand.
4. `layout --format <primary>` — errors (clipping, vertical safe zone) must be fixed; overlap warnings are judged by eye.
5. Fix and repeat, at most 3 rounds per scene; note what remains.

Done when every scene has a still that reads clearly and `layout` reports no errors.

## 3. Whole-film pass

Look at the full sheet in film order: consistent caption style and palette use, no two scenes with the same layout, the end card holds for ~3 s, every cut has a transition. Fix what stands out.

## 4. Gate

Show `.work/stills/<primary>/sheet.jpg` and list per scene what happens and on which words. Gate per the protocol; change requests go back to 2 for those scenes. Then `stage scenes done` (formats and export go stale).
