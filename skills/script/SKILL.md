---
name: script
description: Write the voice-over script for a promo-clip video, split into scenes with a picture idea each.
disable-model-invocation: true
---

# /promo-clip:script

Read `${CLAUDE_PLUGIN_ROOT}/skills/promo-clip/protocol.md` first, then `${CLAUDE_PLUGIN_ROOT}/skills/promo-craft/timing.md` (pacing and the word rules that make lines easy to time). `stage script start`.

## 1. Plan

From `V/brief.md`: target length → word budget of about **2.3 spoken words per second** of voice, minus breathing room — roughly 30 words for 15 s, 62 for 30 s, 125 for 60 s (the film adds ~0.6 s lead-in, a ~1 s pause per scene cut and a 3 s end card). Scenes: one per beat of the chosen story shape, about one per 4–7 s.

## 2. Write `V/script.md`

The format is parsed by the CLI — keep it exact:

```markdown
# Script: <title>

## 01-hook
> [excited, warm] Monday morning! Fifty unread messages, and the coffee isn't even ready.
Picture: a desk piled with paper notes; message bubbles pop up one after another around a sleepy figure.

## 02-problem
> By lunch you've lost track of who asked you what.
Picture: …
```

- `## NN-name` — one per scene, two-digit number + short kebab name; it becomes `scenes/NN-name.js`.
- `> ` lines — exactly what is spoken. Optional `[style tags]` set delivery for AI voices; the opening line gets one that sets the energy. Tags are stripped for QA and timing.
- `Picture:` — what we see, concrete enough to list the art it needs (characters, backdrops, props, screens).

Writing rules:

- The last line ends on the word the music's final hit should land on (usually the product name or the payoff word), then the CTA.
- Write words as they are spoken — numbers and prices in words where the voice must say them a particular way — and keep brand names spelled as in `theme.json` `brandWords`.
- Each scene's first word should be distinctive enough to time the cut on it.

Done when every key message and the CTA from the brief appear, and the word count is within ±10 % of the budget.

## 3. Gate

Show the script and a scene table (scene, spoken text, picture idea, word count, estimated seconds). Gate per the protocol; changes loop back to 2. Then `stage script done` (voice, music and scenes go stale on a re-run).
