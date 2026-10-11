# promo-clip protocol

Rules every stage follows. The conductor (`/promo-clip`) and each stage skill (`/promo-clip:<stage>`) read this first.

## The video folder

The **video folder** (`V`) is the folder holding `promo.json`: the current directory or the nearest parent with one. If there is none, the stage stops and points the user to `/promo-clip`, which creates it.

`V` contains its own copy of the engine (`V/js`, `V/tools`), pinned by `promo.json` `engine`. Its layout:

| Path | What |
|---|---|
| `promo.json` | state: stages, gates, mode, budget, output, spend — written only through the CLI |
| `brief.md` | discovery answers (`## <topic>` sections) |
| `script.md` | the script: `## NN-name` per scene, `> ` spoken lines, `Picture:` idea |
| `theme.json` | palette, fonts, logo, end card, brandWords, spoken overrides, constants |
| `manifest.json` | image key → file (`art manifest` keeps it current) |
| `timeline.js`, `scenes/NN-name.js` | story events and scene modules |
| `assets/` | `vo_raw/`, `vo/`, `music/`, `art/` (+ `raw/`), `img/`, `ref/` |
| `.work/` | renders, stills, sheets (scratch) |
| `out/` | MP4s + `qa_report.md` |

## The CLI

Every action on the video goes through the video's own CLI:

```
node V/tools/cli.mjs <command> … --project V --json
```

`--json` puts the result on stdout (logs on stderr); read the result instead of parsing logs. Exit codes: `0` ok · `1` error · `2` QA found issues (the JSON has `report`) · `3` over budget. `node V/tools/cli.mjs help` lists every command and flag — check it rather than guessing a flag.

Two commands run with the **plugin's** CLI instead, because they act on the engine copy itself: `setup` and `upgrade` — `node "${CLAUDE_PLUGIN_ROOT}/engine/tools/cli.mjs" …`.

The API key (`OPENROUTER_API_KEY`) lives only in the environment or in `.env` in `V` or a parent folder. Ask the user to add it there themselves when a paid step needs it; it never goes into any other file, command line or message.

## Stage lifecycle

1. `stage <s> start`.
2. Do the stage's steps.
3. **Gate** (below).
4. `stage <s> done` — this also marks every later stage that depends on it **stale**, so they re-run.

On an error the stage can't recover from: `stage <s> fail --reason "<one line>"`, tell the user what failed and what it cost so far (`cost`), and stop.

## Gates

Read the mode once per stage (`status --json` → `mode`).

- **gated** — show the options with what each one is (file paths, QA notes, the sheet image), best-ranked first and marked "(Recommended)", and ask with AskUserQuestion. A change request loops back into the stage. Record the decision: `gate <s> "<choice>" --by human`.
- **auto** — take the best-ranked option and record why: `gate <s> "<choice>" --by auto --why "<ranking reason>"`.

Audio and images are reviewed by path: give the user each file's path (on macOS they can type `! open <path>`). Look at sheets and stills yourself with the Read tool before presenting them, so problems are caught before the gate.

## Paid steps and budget

Paid commands (`vo generate`, `vo stt`, `music generate`, `art generate`) estimate first, refuse to run over the budget (exit 3) and record the actual cost in `promo.json`. Before the first paid call of a stage, tell the user the estimate (`--dry-run` where a command has it, else the quote it logs). On exit 3: in gated mode ask whether to raise the budget (`budget <usd>`); in auto mode stop and report. `cost` shows the spend per stage.

## Know-how

Craft knowledge (layout per format, word-timed events, provider quirks, QA checklists, the scene API) is in the `promo-craft` skill: `${CLAUDE_PLUGIN_ROOT}/skills/promo-craft/SKILL.md` lists its files and when each is needed.
