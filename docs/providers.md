# Providers

All paid calls go through [OpenRouter](https://openrouter.ai) with a single key. The engine never contacts any AI provider directly.

---

## Models

Model IDs, defaults, fallbacks and prices come from `providers.json` in the video folder (copied from the engine at `setup`; stays pinned to that version until `upgrade`).

### TTS (voice)

| Model | Role | Price |
|---|---|---|
| `google/gemini-3.8-flash-tts` | default | $0.000016 / char |
| `google/gemini-3.1-flash-tts-preview` | fallback 1, also auditioned | $0.000035 / char |
| `microsoft/mai-voice-2` | fallback 2 | $0.000022 / char |

`audition` runs the default and `google/gemini-3.1-flash-tts-preview` in parallel for ranking.

Available voices (both Gemini models): `Aoede`, `Kore`, `Leda`, `Zephyr`, `Puck`, `Charon`, `Fenrir`, `Orus`. Default: `Aoede`.

`microsoft/mai-voice-2` offers one voice: `Harper`.

### STT (word timing)

| Model | Role | Price |
|---|---|---|
| `assemblyai/universal-3-5-pro` | default | $0.0075 / minute |
| `openai/whisper-large-v3` | fallback | $0.0005 / minute |

AssemblyAI requires WAV input; the CLI converts automatically.

### Music

| Model | Role | Price |
|---|---|---|
| `google/lyria-3-pro-preview` | default | $0.08 / generation |
| `google/lyria-3-clip-preview` | fallback | $0.04 / generation |

### Images

| Model | Role | Price (standard / 2K) |
|---|---|---|
| `google/gemini-3.1-flash-image` | default | $0.068 / $0.10 per image |
| `google/gemini-3-pro-image` | fallback | $0.14 / $0.20 per image |

`--hires=true` (or `--size 2K`) uses the `per_image_2k` price. Use it for 4K output.

### AI judge (audio review)

| Model | Role | Price |
|---|---|---|
| `google/gemini-3.8-flash` | default | $0.004 / call |
| `google/gemini-3.1-flash-lite` | fallback | $0.002 / call |

---

## Key handling

The key is read in this order:

1. `OPENROUTER_API_KEY` environment variable
2. `.env` file in the video folder (`V/.env`)
3. `.env` in any parent directory of the video folder

The key is never written to `promo.json`, logs or command-line arguments. The CLI (`check --need-key`) tests whether a key is present before any paid call.

---

## Overriding models per video

Edit `promo.json` directly and add a `provider_overrides` field. Each key is a need name (`tts`, `stt`, `music`, `images`, `judge`); fields are merged on top of `providers.json`:

```json
{
  "provider_overrides": {
    "tts": {
      "default": "microsoft/mai-voice-2",
      "fallbacks": []
    },
    "music": {
      "default": "google/lyria-3-clip-preview"
    }
  }
}
```

The override is applied at load time by `loadProviders()` in `lib/cost.mjs`. Only fields you specify are changed; everything else (prices, gotchas, endpoint) comes from `providers.json`.

There is no CLI command for this — edit `promo.json` directly.

---

## Gotchas

### TTS

- Style directions in plain prose are read aloud. Use `[tags]` instead: `[upbeat, warm, conversational]`.
- An inline tag on the opening line sets the energy of the whole take: `[excited] First line…`.
- Takes vary in length by 10–15 % and sometimes add or drop words. Every take is transcribed and diffed; a take with word errors does not ship.
- Output is raw PCM 24 kHz s16le mono; the CLI converts it.

### STT

- AssemblyAI accepts WAV only.
- Brand names come back joined or split ("PromoClip" for "promo clip"). Set `theme.json` `spoken` to map regex patterns to canonical forms: `{ "promo\\s*clip": "promo clip" }`.

### Music (Lyria)

- Ignores the requested BPM.
- Drifts into retro funk or disco when the prompt leads with product context; use a style-only prompt (genre, mood, instruments, energy curve).
- Picks its own length. The CLI appends "about N seconds" to the prompt (film length + 6 s).
- Tracks have no hard ending. The engine places the final cue on the onset of the last chord.
- ZDR (zero-data-retention) accounts may be blocked. The CLI tries each fallback automatically.

### Images

- Generate subjects on solid magenta (#FF00FF) for chroma keying. `art process` keys and die-cuts automatically.
- Adds a thin ground line under subjects even when instructed not to. Erase it on the raw image before running `art process`.
- Edits cannot restructure geometry (a different pose, a different object shape). Regenerate from a changed text prompt instead.
- `--ref` uploads reference images to keep a character consistent across poses.
