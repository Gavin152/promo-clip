# Timing

All timing comes from data: the voice-over word times (`vo/timing.json`) and the music cue sheet (`assets/music/cues.json`). A new voice take or music track re-times the whole film with no code change — as long as no time is typed by hand.

## Events in `timeline.js`

| | |
|---|---|
| `W(word, nth=0)` | film time the nth occurrence of `word` starts |
| `WE(word, nth=0)` | … ends |
| `Wa(word, after)` | first occurrence at or after a time (`Wa('in', W('wifi'))`) |
| `S(phrase)` | start of the sentence containing `phrase` |
| `sceneStart(word, nth)` | `W(word, nth) - 0.3`: a scene cut |
| `HIT.reveal`, `HIT.final`, `HIT.end` | the music's lift, final hit (on the target word), end |
| `onBeat(t)` / `accent(t)` / `beatFrom(t, k)` | snap to the nearest beat (±150 ms) / music accent / k-th beat after t |
| `BEAT`, `DURATION` | beat length, film length |

- **Exact word match**: `W('no')` matches "no", never "now". Matching ignores case and punctuation (`W('wifi')` finds "Wi-Fi,"; `W('€19.90')` works) but not spelling — use the word as it appears in `vo/timing.json`.
- A repeated word needs its `nth` (0-based). Count it in timing.json, not the script — the voice may add or drop words.
- A missing word throws at build time with the word's name: fix the word, never replace it with a number.

## Cuts and pacing

- **Cuts sit 0.3 s before the next scene's first word** (`sceneStart`), inside the pause the voice stage widened to ~1 s, so each scene's final state holds for a beat before the swipe.
- An element enters **on** its word or 0.1–0.2 s before it — never after the word is over.
- One new element every 0.8–1.5 s; a scene under 3 s feels hectic, and a final state needs ~0.8 s on screen to land.
- The end card holds ~3 s after the last word.
- Visual accents within ±150 ms of a music beat or accent snap to it (`onBeat`, `accent`); further away, the word wins.

## Music

The track is **placed, never stretched**: shifted so its final hit lands on the target word (default the last word). It ducks automatically under the voice. A stronger lift is placed on the reveal word when the track has one.

## Writing for timing (script stage)

- Each scene's first word should be unique or easily counted; that is where the cut is timed.
- Numbers, prices and acronyms written as they should be spoken; the timing then shows them as one token each where the transcript does.
- Words that carry a visual beat ("blink", "stamp", "now") make the strongest events — put them where the picture should change.
