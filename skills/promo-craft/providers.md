# Providers

All AI assets go through OpenRouter with one key (`OPENROUTER_API_KEY`). Models, fallbacks and estimate prices are in the video's `providers.json`; `promo.json` `provider_overrides` swaps them per video. A model blocked by account policy (zero-data-retention, region) is skipped for the next fallback automatically.

## TTS (voice)

Gemini 3.8 Flash TTS and Gemini 3.1 Flash TTS are auditioned **together** — neither reliably wins; rank the takes.

- Style goes in `[tags]` (`[upbeat, warm, conversational]`). Directions in plain prose are read aloud.
- An inline tag on the opening line sets the energy of the whole take (`[excited] Charter week! …`).
- Takes vary in length by 10–15 % and sometimes add or drop words ("Huh", a repeated word) — every take is transcribed and diffed against the script; a take with word errors does not ship.
- Output is raw PCM 24 kHz mono; the CLI converts it.

## STT (word timing)

AssemblyAI Universal 3.5 Pro (fallback Whisper large v3). WAV only — the CLI converts. Brand names come back joined or split ("PromoClip", "Snap Tracks"); QA treats 2–3-word compounds as matches, `theme.json` `spoken` maps other spoken forms (`{ "sail\\s*tracks?": "sailtrax" }`).

## Music

Lyria 3 Pro (fallback Lyria 3 Clip).

- **Style-only prompts**: genre, mood, instruments, energy curve. A prompt led by the product story drifts into retro funk/disco.
- Ignores the requested BPM. Picks its own length unless asked (the CLI asks for the film length + slack; expect ±40 %).
- No hard ending: the final hit is placed on the onset of the last chord; if it lands wrong, set `cues.json` `manual.final`.

## Images

Nano Banana 2 = Gemini 3.1 Flash Image (fallback Gemini 3 Pro Image). `--hires=true` (2K) for 4K output.

- Subjects come on solid #FF00FF and are keyed and die-cut by `art process`; the house-style suffix is added by the CLI.
- It adds a thin ground line under subjects even when told not to — erase it on the raw image or regenerate.
- **Edits can't restructure geometry** (changing a car body, a pose): regenerate from text with a changed prompt. Edits can change clothing, expression or setting.
- Reference images (`--ref`) keep a character consistent across poses.

## Judging audio

An audio-capable chat model can judge delivery, one clip per request (comparing several in one request swaps their identities). Its timing claims echo the prompt — verify timing with the transcript, not the judge.
