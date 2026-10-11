---
name: art
description: Make the characters, backdrops, props and screens for a promo-clip video — AI-generated in the house style or processed from your own visuals.
disable-model-invocation: true
---

# /promo-clip:art

Read `${CLAUDE_PLUGIN_ROOT}/skills/promo-clip/protocol.md` first, and the images section of `${CLAUDE_PLUGIN_ROOT}/skills/promo-craft/providers.md`. `stage art start`.

## 1. Art list

From every `Picture:` line in `V/script.md` and the `## Visuals` and `## End card` sections of `V/brief.md`, list each asset once:

| key | kind | source | used in |
|---|---|---|---|

- **kind** — `subject` (character, prop, object: a die-cut sticker drawn with `art()`), `backdrop` (full-frame scene behind a whole scene, drawn with `backdrop()`), `screen` (app screenshot shown in `phone()`), `photo` (real photo, e.g. in a `polaroid()`), `logo`/`badge`/`qr`.
- **source** — `ai`, or the user's file.
- **key** — short snake_case; it becomes the manifest key the scenes use.

Small things the collage style draws in code need no art: sun, moon, clouds, gulls, phone frames, polaroid frames, speech bubbles, icons (wifi, check, cross, stopwatch, gear, trophy, padlock, credit card, keypad), stamps, confetti, data tags, stick-figure people (`person()`), boats, islands, compass, maps. List only what must be pictured. Reuse one character pose across scenes where the script allows; each AI image costs ~$0.07.

Show the list and its estimate (AI count × the price from `art generate`'s log) before generating.

## 2. Make each asset

- **AI subject:** `art generate <key> "<what, pose, expression, clothing, colours>"` then `art process <key>`. Add `--ref <file>` (repeatable) for a style or likeness reference from `assets/ref/`. One subject per image, full body for characters.
- **AI backdrop:** `art generate <key> "<place, light, mood>" --kind backdrop` then `art process <key> --kind backdrop` (fills the primary format's aspect; JPEG).
- **Own subject cut-out:** on a plain magenta background → `art process <file> --out <key>`; anything else → ask for a cut-out PNG, or use it as a framed photo instead.
- **Own photo / screenshot:** `art process <file> --nokey --out <key>` (just resized), or copy it into `assets/img/` and run `art manifest`.
- **QR / logo / badges:** `art qr <url>` (done in discovery if the end card has a QR); logo and badge files in `assets/img/` + `art manifest`.

After each `art process`, look at the result (Read the PNG): a stray ground line under the subject, a cut-off limb or a magenta fringe means regenerate (edits can't fix geometry — change the prompt and generate again).

Done when every row of the art list has a file in `manifest.json`.

## 3. Check

- `art check` — warns when an asset would look soft at the largest output size; re-process with the `--max` it suggests, or regenerate with `--hires=true` for 4K.
- `art contact` → `.work/contact_sheet.jpg`. Read it.

**Gate:** the contact sheet + the art list. Gate per the protocol; a rejected asset is regenerated (new prompt) or replaced. Then `stage art done` (scenes go stale on a re-run).
