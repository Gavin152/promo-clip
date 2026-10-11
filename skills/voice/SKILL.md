---
name: voice
description: Make the voice-over for a promo-clip video — AI takes auditioned and ranked, or your own recording — and time every word.
disable-model-invocation: true
---

# /promo-clip:voice

Read `${CLAUDE_PLUGIN_ROOT}/skills/promo-clip/protocol.md` first, and the TTS section of `${CLAUDE_PLUGIN_ROOT}/skills/promo-craft/providers.md`. `stage voice start`. The `## Voice` section of `V/brief.md` says which path: AI or own recording.

## AI voice

1. **Direction.** Choose the voice from the brief (one of `V/providers.json` `tts.voices` for the audition models) and a style tag in square brackets, e.g. `[upbeat, warm, conversational, like telling a friend great news]`. The script's own inline opening tag stays.
2. **Takes.** `vo generate take --voice <V> --tag "<tag>" --takes 2` — two takes from each audition model (`tts.audition`), named `take_<model>_<n>`. It logs the estimate before calling.
3. **Transcribe and check** each take: `vo stt assets/vo_raw/<take>.wav`, then `vo qa assets/vo_raw/<take>.aai.json` (exit 2 = word errors; keep the report, it is a ranking input, not a stop).
4. **Rank:** `vo rank <take> <take> …` → best first (word errors, then brand-word closure, mid-phrase pauses, duration).
5. If no take has zero word errors, generate one more round (`--takes 2`, new base name) and repeat 3–4. After two rounds, take the best and show its diff at the gate.

Done when every take is transcribed, QA'd and ranked.

**Gate:** the top three takes — path, model, length, QA notes (word errors, long pauses, low-confidence words). Gate per the protocol (auto picks rank 1).

6. **Finish the chosen take:** `vo process <take>` → `assets/vo/vo.wav`; `vo stt` (transcribes `assets/vo/vo.wav`); `vo timing`; `vo gaps`.

## Own recording

1. `vo import <file>` → `assets/vo/vo.wav`.
2. Word times: `vo stt` then `vo timing` — or, when the user has word times already (a forced aligner, an earlier export), `vo timing --words <file>` with no API call.
3. `vo gaps`.
4. `vo qa assets/vo/vo.aai.json` (after `vo stt`). **Gate:** the diff — an own recording that deviates from the script is the user's call; offer to update `script.md` to match what was said.

## Finish (both paths)

`V/vo/timing.json` exists and every scene's first word is in it (the scenes stage times cuts on them). `stage voice done` — music placement and scenes go stale on a re-run.
