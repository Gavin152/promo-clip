# Getting started

## Prerequisites

| Requirement | Minimum | Notes |
|---|---|---|
| Node.js | 20 | `node --version` to check |
| Chrome or Chromium | any recent | headless renderer; see below |
| ffmpeg | bundled | installed automatically by `npm ci` via `ffmpeg-static` |
| OpenRouter key | — | only for AI voice, music and art; BYO assets work without it |

**Chrome / Chromium.** The engine renders video frames in a headless browser. It searches these locations in order:

1. `CHROME_PATH` environment variable
2. Standard install paths for your OS (macOS, Windows, Linux)
3. `google-chrome-stable`, `google-chrome`, `chromium`, `chromium-browser`, `chrome` on `PATH`
4. Microsoft Edge (Chromium-based; present on every Windows install)

If no browser is found, `setup` and `check` print an install hint for your OS. `CHROME_PATH` can point at any Chromium-based binary. Running as root on Linux (Docker, CI) adds `--no-sandbox` automatically; set `CHROME_NO_SANDBOX=1` to force it.

**OpenRouter key.** Create one at <https://openrouter.ai/keys>. Put it in a `.env` file in the video folder:

```
OPENROUTER_API_KEY=sk-or-…
```

The CLI reads `OPENROUTER_API_KEY` from the environment first, else from the nearest `.env` in the video folder or a parent folder. `setup` git-ignores `.env`. The key is never written to bundles, logs or `promo.json`.

---

## Install

### From the marketplace

```
/plugin marketplace add Gavin152/promo-clip
/plugin install promo-clip@promo-clip
```

### Dev / local

Point Claude Code at the repo directly:

```
claude --plugin-dir ~/path/to/promo-clip
```

Both methods make the `/promo-clip` command available in every Claude Code session.

---

## First video walkthrough

Start with:

```
/promo-clip
```

If there is no `promo.json` in the current directory or a parent, the conductor asks for a name and a folder, then runs:

```
node <plugin>/engine/tools/cli.mjs setup <folder> --name "My Product" --json
```

`setup` copies the engine into the video folder, creates `promo.json`, `theme.json`, `manifest.json`, `assets/`, `scenes/`, `out/` and `vo/`, then runs `npm ci` in `tools/`.

### The eight stages

| Stage | What happens | Costs money? |
|---|---|---|
| discover | Brief — product, audience, format, length | No |
| script | Scene-by-scene script with VO lines | No (Claude tokens) |
| voice | TTS takes generated and ranked, or your recording imported | Yes (TTS + STT, if AI) |
| music | Lyria track generated or your file imported, BPM placed | Yes (music, if AI) |
| art | Subject and backdrop images generated or imported | Yes (images, if AI) |
| scenes | `timeline.js` and `scenes/*.js` written by parallel agents | No (Claude tokens) |
| formats | Layout adjusted for vertical and square | No (Claude tokens) |
| export | MP4s rendered for every format and size | No |

### What each gate shows

In **gated mode** (the default) the conductor pauses at the end of each stage and shows you the result before continuing. Examples:

- **Voice gate:** ranked takes with their file paths and a word-diff report. Open a file to listen (`open <path>` on macOS). Choose a take or ask for another.
- **Music gate:** candidate tracks, best first: file path, score, BPM, and where the reveal and final hit land on the script.
- **Art gate:** a contact sheet of all generated images (`.work/contact_sheet.jpg`).
- **Scenes / formats gates:** a labelled stills sheet (`stills --sheet`) for each format.

### Gated vs auto mode

```
/promo-clip auto mode          # runs every stage without pausing
/promo-clip gated mode         # pauses at every gate (default)
```

Or set it before a run:

```
node V/tools/cli.mjs mode auto --project V
```

### Budget

The default budget is $10 of OpenRouter spend. Raise or lower it:

```
/promo-clip spend at most $5
```

or:

```
node V/tools/cli.mjs budget 5 --project V
```

A paid command that would go over budget is refused before the API call is made (exit code 3). In gated mode the conductor asks whether to raise the limit; in auto mode it stops.

---

## Resuming and redoing a stage

`/promo-clip` always resumes at the first stage that is not done. To redo a specific stage:

```
/promo-clip new music
/promo-clip rewrite the script
/promo-clip different voice
```

The conductor marks that stage stale, which also propagates staleness to every stage that depends on it, then re-runs from there.

To redo a stage directly:

```
/promo-clip:music
/promo-clip:scenes
```

---

## BYO voice, music and visuals

You can skip any AI call and supply your own files.

**Voice.** Put your recording in any common audio format and run:

```
node V/tools/cli.mjs vo import my-recording.wav --project V
```

This converts it to `assets/vo/vo.wav`. Then run STT to get word times (WAV only):

```
node V/tools/cli.mjs vo stt --project V
```

Or provide your own word times and skip the API call. The file is JSON, times in seconds relative to `vo.wav`:

```json
{ "words": [ { "word": "Introducing", "start": 0.05, "end": 0.62 }, { "word": "Demo", "start": 0.70, "end": 0.98 } ] }
```


```
node V/tools/cli.mjs vo timing --words my-times.json --project V
```

**Music.** Import any MP3 or WAV directly:

```
node V/tools/cli.mjs music import my-track.mp3 --project V
```

This installs the file as `assets/music/track.mp3` and runs the beat-grid analysis to produce `assets/music/cues.json`.

**Art.** For a subject drawn on solid magenta (#FF00FF), `art process` keys out the background and adds a die-cut sticker border:

```
node V/tools/cli.mjs art process my-subject.png --project V
```

For photos and screenshots, skip the key and just resize:

```
node V/tools/cli.mjs art process screenshot.png --nokey --out app_home --project V
```

Use `--kind backdrop` for a full-frame background. Or copy finished images into `assets/img/` and run `art manifest`, which scans `assets/art/` and `assets/img/` and writes the key-to-path table in `manifest.json`.

---

## Where outputs land

```
V/out/<name>_<format>_<size>.mp4        master (CRF 16, high quality)
V/out/<name>_<format>_<size>_web.mp4    web-optimised (smaller file)
V/out/qa_report.md                      QA verdict
V/out/qa_report.json                    machine-readable QA results
```

`<name>` is the video name with anything other than letters and digits turned into `_`. A video named `my-product` exported at 1080p landscape and vertical produces:

```
V/out/my_product_landscape_1080p.mp4
V/out/my_product_landscape_1080p_web.mp4
V/out/my_product_vertical_1080p.mp4
V/out/my_product_vertical_1080p_web.mp4
```

---

## Permission settings for parallel scene agents

The scenes and formats stages dispatch parallel subagents, one per scene. Background subagents can't ask you for permission, so they need two settings in Claude Code (for example `.claude/settings.json` in the folder you run `claude` from):

```json
{
  "permissions": {
    "defaultMode": "acceptEdits",
    "allow": ["Bash(node *)"]
  }
}
```

- `acceptEdits` lets the subagents write their scene files. An allow rule alone is not enough.
- `Bash(node *)` lets them run the video's CLI.

You can also start Claude Code with `claude --permission-mode acceptEdits`. Without these settings the stage notices the denial, tells you once, and writes the scenes one at a time instead.

---

## Troubleshooting

**Chrome not found.**

```
CHROME_PATH=/usr/bin/chromium node V/tools/cli.mjs check --project V
```

Set `CHROME_PATH` in your shell profile (it is not read from `.env`).

**Exit code 1 — general error.**

Read the error message on stderr. Common causes: missing `promo.json` (run `setup` first), missing `node_modules` (run `npm ci` in `V/tools/`), bad flag or argument.

**Exit code 2 — QA failed.**

The export passed but `qa` found a problem: loudness out of range, audio/video out of sync, layout clipping or safe-zone violation, or a placeholder scene. Read `V/out/qa_report.md` for the details. Fix the issue, then run `export` again.

**Exit code 3 — over budget.**

The next paid call would exceed the budget. Raise it:

```
node V/tools/cli.mjs budget <new-limit> --project V
```

**ZDR (zero-data-retention) blocks.**

OpenRouter accounts with zero data retention (ZDR) enforced can't use some models, Google's Lyria music models among them. The CLI automatically tries the next fallback model (`google/lyria-3-clip-preview`). If every fallback is blocked, the stage fails with exit code 1 and names the blocked models. Switch to a non-ZDR account or import your own music file.
