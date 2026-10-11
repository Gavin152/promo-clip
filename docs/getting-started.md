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

If Chrome is not found, `setup` stops with an install hint. On Linux you can set `CHROME_PATH` to any Chromium binary.

**OpenRouter key.** Create one at <https://openrouter.ai/keys>. Put it in a `.env` file in the video folder:

```
OPENROUTER_API_KEY=sk-or-…
```

`.env` is git-ignored. The key is never read from any other location and never passed on the command line.

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
- **Music gate:** the stills sheet (`out/.work/*.jpg`) with the beat grid and cue placement shown.
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

Or provide your own word-time file (one JSON object per line, `{ word, start, end }` in seconds from the VO start) and skip the API call:

```
node V/tools/cli.mjs vo timing --words my-times.json --project V
```

**Music.** Import any MP3 or WAV directly:

```
node V/tools/cli.mjs music import my-track.mp3 --project V
```

This installs the file as `assets/music/track.mp3` and runs the beat-grid analysis to produce `assets/music/cues.json`.

**Art.** Drop image files into `assets/art/raw/`, then process them:

```
node V/tools/cli.mjs art process my-subject.png --project V
node V/tools/cli.mjs art manifest --project V
```

`art process` keys out the magenta (#FF00FF) background and die-cuts the subject. For a full-bleed backdrop use `--kind backdrop`. Then `art manifest` scans `assets/art/` and `assets/img/` and writes the key-to-path table in `manifest.json`.

---

## Where outputs land

```
V/out/<name>_<format>_<size>.mp4        master (CRF 16, high quality)
V/out/<name>_<format>_<size>_web.mp4    web-optimised (smaller file)
V/out/qa_report.md                      QA verdict
V/out/qa_report.json                    machine-readable QA results
```

For example, a video named `my-product` exported at 1080p landscape and vertical produces:

```
V/out/my-product_landscape_1080p.mp4
V/out/my-product_landscape_1080p_web.mp4
V/out/my-product_vertical_1080p.mp4
V/out/my-product_vertical_1080p_web.mp4
```

---

## Permission settings for parallel scene agents

The scenes and formats stages dispatch parallel subagents to write scene files concurrently. This requires two settings in your Claude Code project settings (`.claude/settings.json`):

```json
{
  "defaultMode": "acceptEdits",
  "permissions": {
    "allow": ["Bash(node *)"]
  }
}
```

- `"defaultMode": "acceptEdits"` — lets subagents write files without prompting.
- `"Bash(node *)"` — lets subagents run the CLI.

Without these settings the scene stage detects the denial, tells you once, and falls back to writing scenes one at a time.

Note: video folders outside the repo work fine as usual; only files under a git-ignored `.work/` inside the repo are blocked even for the main session.

---

## Troubleshooting

**Chrome not found.**

```
CHROME_PATH=/usr/bin/chromium-browser node V/tools/cli.mjs check --project V
```

Set `CHROME_PATH` in the shell or in the video folder's `.env`.

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

OpenRouter routes `google/lyria-3-pro-preview` through Google infrastructure; some accounts are blocked. The CLI automatically tries the next fallback model (`google/lyria-3-clip-preview`). If every fallback is blocked, the stage fails with exit code 1 and names the blocked models. Switch to a non-ZDR account or import your own music file.
