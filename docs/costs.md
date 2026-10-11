# Costs

---

## What costs money

**OpenRouter only.** Only four CLI commands make paid API calls:

| Command | Need | Provider |
|---|---|---|
| `vo generate` | TTS (text-to-speech) | OpenRouter → Gemini TTS / MAI Voice |
| `vo stt` | STT (speech-to-text) | OpenRouter → AssemblyAI / Whisper |
| `music generate` | music generation | OpenRouter → Lyria |
| `art generate` | image generation | OpenRouter → Gemini Image |

`vo import`, `music import`, `art process` and all render commands (`build`, `stills`, `export`) are free.

**Claude tokens are separate.** The conductor and stage skills run as Claude Code sessions. Those token costs are billed to your Anthropic account, not to OpenRouter, and are not tracked in `promo.json`. They are not included in the budget check.

---

## Per-unit prices

Prices are from `providers.json` (checked against the OpenRouter models API on 2026-10-11). The actual spend uses the cost OpenRouter reports; the unit prices below are used only for pre-call estimates when the actual cost is not yet available.

### TTS

| Model | Price |
|---|---|
| `google/gemini-3.8-flash-tts` (default) | $0.000016 / character |
| `google/gemini-3.1-flash-tts-preview` | $0.000035 / character |
| `microsoft/mai-voice-2` | $0.000022 / character |

A 200-word (≈1000-character) script costs roughly $0.016–$0.035 for one TTS take.

### STT

| Model | Price |
|---|---|
| `assemblyai/universal-3-5-pro` (default) | $0.0075 / minute |
| `openai/whisper-large-v3` | $0.0005 / minute |

A 30-second VO: ~$0.004 (AssemblyAI) or ~$0.00025 (Whisper).

### Music

| Model | Price |
|---|---|
| `google/lyria-3-pro-preview` (default) | $0.08 / generation |
| `google/lyria-3-clip-preview` | $0.04 / generation |

### Images

| Model | Price |
|---|---|
| `google/gemini-3.1-flash-image` (default) | $0.068 per image (standard) · $0.10 at 2K |
| `google/gemini-3-pro-image` | $0.14 per image (standard) · $0.20 at 2K |

2K (`--hires=true`) is recommended for 4K output.

### AI judge (audio review)

| Model | Price |
|---|---|
| `google/gemini-3.8-flash` (default) | $0.004 / call |
| `google/gemini-3.1-flash-lite` | $0.002 / call |

---

## Budget and spend tracking

### How it works

1. Before every paid call, `lib/paid.mjs` estimates the cost from `providers.json` prices.
2. If the estimate exceeds what is left of the budget, the call is refused before it is made (exit code 3).
3. After the call, the actual cost is read from OpenRouter's generation stats (polled up to ~20 s).
4. If OpenRouter does not report a cost in time, the estimate is recorded and flagged `estimated: true` in `promo.json`.
5. `promo.json` `budget.spentUsd` and `stages[stage].cost` are updated atomically.

### Viewing the spend

```bash
node V/tools/cli.mjs cost --project V
```

Output example:

```
spent $0.234 of $10.00 (left $9.766)
  voice     $0.026  (4 calls)
  music     $0.080  (1 call)
  art       $0.128  (2 calls, 1 estimated)
```

### Setting the budget

```bash
node V/tools/cli.mjs budget 5 --project V     # set limit to $5
node V/tools/cli.mjs budget --project V        # show current limit and spend
```

### Exit code 3

Exit code 3 means the next call would exceed the budget. The message names the call, the estimate and how much is left. To continue, raise the limit and retry the stage.

### Estimated flag

An entry with `"estimated": true` in `promo.json` `spend` means OpenRouter did not confirm the cost in time. The estimate is conservative (based on `providers.json` unit prices); the actual charge on OpenRouter may differ.

---

## Realistic totals

These figures are from actual test runs:

| Run | What | OpenRouter cost | Claude tokens |
|---|---|---|---|
| Phase 2 smoke test | 1 TTS take, STT, 1 Lyria track, 1 subject image | **$0.23** | — |
| Phase 4 5-scene teaser | AI voice + music + art (5 scenes) | **$0.43** | ≈ $10 |
| Phase 3 auto run | full 8-stage run, all BYO assets | **$0** | ≈ $1.39 |

The scenes stage (parallel agents writing 5 scene files, one reviewer pass, one fix pass) cost approximately **$10 of Claude tokens**. That is a worst case for a complex video; a simpler 3-scene video costs less.

Claude token costs depend on how many turns the session takes (complexity of the script, number of review rounds) and on which Claude model is configured in Claude Code.

---

## Spending $0

Every AI step has a BYO path:

| Stage | How to skip AI cost |
|---|---|
| voice | `vo import` your own recording, then `vo timing --words` with your own word-time file |
| music | `music import` your own track |
| art | put your own images in `assets/art/raw/` and `assets/img/`, then `art process` + `art manifest` |
| scenes | write `timeline.js` and `scenes/*.js` by hand |

With all BYO assets, the entire pipeline (script through export) costs $0 on OpenRouter.

---

## Render time

Rendering is done on the CPU (headless Chrome canvas + ffmpeg). Approximate times on Apple M-series:

| Output size | Approximate render time |
|---|---|
| 720p | 1× real time |
| 1080p | ~2× real time |
| 4K | ~4× real time (4× the pixels to encode) |

A 30-second 1080p export takes roughly 60 seconds of wall-clock time. A 4K export of the same video takes roughly 4 minutes.

Parallel exports of multiple formats run sequentially (one format at a time). `export --all` exports every format defined in `promo.json` `output.formats`.
