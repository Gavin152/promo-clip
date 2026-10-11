---
name: export
description: Render a promo-clip video to MP4 in every chosen format and size, and QA the results.
disable-model-invocation: true
---

# /promo-clip:export

Read `${CLAUDE_PLUGIN_ROOT}/skills/promo-clip/protocol.md` first, and `${CLAUDE_PLUGIN_ROOT}/skills/promo-craft/qa.md` (what QA checks and how to fix each failure). `stage export start`.

1. `export --all` — master + web MP4 for every format × size in `promo.json` `output`, at its fps (one build). Rendering takes roughly 1–2 s of wall time per second of film at 1080p per format; 4K about four times that. Run it in the background for long jobs and report progress.
2. `qa` → `out/qa_report.md` + `.json`: duration, size, fps, audio/video length, loudness (−14 LUFS, ≤ −1 dBTP), QR decode on the end card, layout in every format. Exit 2 lists the issues; fix them in the stage they belong to (see `qa.md`), re-export only what changed (`export --format F --size S`), re-run `qa`.

Done when `qa` passes.

**Gate:** the file list in `out/` (sizes, durations), the QA summary, and a suggestion to watch the web version of the primary format first. Gate per the protocol — this is the final cut; a change request names the stage to revisit (e.g. "the music is too loud" → music mix; "scene 3 too busy" → scenes). Then `stage export done`.
