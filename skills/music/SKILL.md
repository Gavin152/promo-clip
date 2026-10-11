---
name: music
description: Make the soundtrack for a promo-clip video — AI candidates ranked by fit, or your own track — placed on the story and mixed under the voice.
disable-model-invocation: true
---

# /promo-clip:music

Read `${CLAUDE_PLUGIN_ROOT}/skills/promo-clip/protocol.md` first, and the music section of `${CLAUDE_PLUGIN_ROOT}/skills/promo-craft/providers.md`. The voice stage must be done (placement needs the word times). `stage music start`. The `## Music` section of `V/brief.md` says which path: AI or own track.

Placement words: the final hit lands on the last spoken word by default; the reveal lift on the first word of scene 2 (3+ scenes). Override with `--target word[#n]` / `--reveal word[#n]` on `cues` and `import` when the brief names other moments.

## AI music

1. **Prompt.** Style only — genre, mood, instruments, energy curve — from the brief's `## Music` section. No product story in it (it pulls the generator off-style). The CLI adds "instrumental, about N seconds" from the film length.
2. **Candidates:** `music generate cand --n 3 --style "<style>"` (or `--prompt <file>`) → `assets/music/alternates/cand_1…3.mp3`. It logs the estimate first.
3. **Rank:** for each candidate `music cues assets/music/alternates/<file> --analyse-only --json` → `score` (0–100: lift at the reveal, how exactly the final hit can land on the target word, loudness), plus BPM and hits.

Done when every candidate has a score.

**Gate:** candidates best first — path, score, BPM, where the reveal and final hit fall. Gate per the protocol (auto picks the top score). A "none fits" answer loops back to 1 with a changed style.

4. **Install:** `music import <chosen file>` → `assets/music/track.*` + `cues.json` (placement; `manual` overrides in cues.json survive re-analysis).

## Own track

1. `music import <file>` (add `--keep-mix` to keep an existing mix block).
2. If the track has no clear button ending, the final hit may land wrong: check the `film.final` it reports against the target word's time; set `"manual": { "final": <track seconds> }` in `cues.json` to the onset of the last chord and re-run `music cues`.

## Mix (both paths)

1. `music mix` — renders the stems (works before the scenes exist: an audio-only build) and sets duck level and section trims so the voice sits ~13.5 dB above the music.
2. `music check` — exit 2 if the median is more than 2 dB off. Run `music mix` once more on exit 2; if it still fails, report the numbers.

Done when `music check` passes. `stage music done` (export goes stale).
