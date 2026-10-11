---
name: discover
description: Guided interview for a promo-clip video — writes brief.md, the theme and the output settings.
disable-model-invocation: true
---

# /promo-clip:discover

Read `${CLAUDE_PLUGIN_ROOT}/skills/promo-clip/protocol.md` first. Then `stage discover start`.

## 1. Pre-fill

Before asking anything, collect what is already known so the interview confirms instead of asks:

- an existing `V/brief.md` (a re-run: show each answer and ask only what should change);
- `promo.json` / `brief.md` of a parent or sibling video folder (same product, earlier clip);
- brand material at a folder or URL the user names: logo (SVG/PNG), colours, fonts, app screenshots, website tagline. Copy files into `V/assets/ref/` (style references) or `V/assets/img/` (logo, screenshots, badges — used as-is).

## 2. Interview

One question at a time, multiple choice with AskUserQuestion wherever the answer has a natural set (offer pre-filled answers as the first, recommended option). Topics, in order:

1. **Project** — name, one-line description, website, brand material.
2. **Goal and audience** — who it is for, what they should do afterwards.
3. **Key messages** — 3–5 messages, plus the call to action.
4. **Length** — 15 s, 30 s, 60 s, or custom.
5. **Output** — formats (any of 16:9, 9:16, 1:1), the primary format, sizes (720p, 1080p, 1440p, 4K or WxH), fps (24, 25, 30, 60).
6. **Tone and story shape** — problem → reveal → how it works → CTA; feature tour; testimonial-style.
7. **Voice** — AI voice (language, gender, energy; offer 2–3 voices from `V/providers.json` `tts.voices`) or the user's own recording (path).
8. **Music** — AI music (genre, mood, instruments, where it drops and lifts) or the user's own track (path).
9. **Visuals** — main characters, settings, must-have screens (screenshots), own photos/assets, style references.
10. **End card** — logo (text or image), QR target URL, store badges, website, tagline.
11. **Mode and budget** — gated or auto; a cost limit in USD (a typical 30 s clip spends $1–3 on AI assets).

Done when every topic has an answer (or an explicit "not needed").

## 3. Write

- `V/brief.md` — one `## <topic>` section per topic above, in that order, answers as short bullets. The `## Music` section holds a style-only description (genre, mood, instruments, energy curve) — the music stage feeds it to the generator as is.
- `V/theme.json` — `name`, `palette` (brand colours mapped onto the engine's palette roles), `logo`, `endCard`, `brandWords` (lower-case brand words, for voice QA), and `fontFiles` for a brand font the user supplied. Palette roles and the theme fields: `${CLAUDE_PLUGIN_ROOT}/skills/promo-craft/theme.md`.
- Output, mode, budget through the CLI: `output --formats … --primary … --sizes … --fps …`, `mode gated|auto`, `budget <usd>`.
- A QR target: `art qr <url>`; a logo image or screenshots in `assets/img/`: `art manifest`.

## 4. Gate

Show a one-page summary of the brief (product, audience, messages + CTA, length, formats/sizes/fps, tone, voice, music, visuals, end card, mode, budget). Gate per the protocol; changes loop back to 2 for the affected topics only. Then `stage discover done`.
