# QA

What each check measures, its threshold, and the stage that fixes a failure.

## Voice (`vo qa`, `vo rank`)

| check | pass | fix |
|---|---|---|
| word diff vs script | 0 missing / extra / substituted words | next take; for brand spellings add `theme.json` `spoken` |
| mid-phrase pauses | none > 250 ms where the script has no punctuation | next take |
| brand-word closure | no audible gap inside a brand word | next take, or a tag asking for a smoother read |
| scene pauses | ~0.85–1.0 s at every scene boundary | `vo gaps` |

## Music (`music import`, `music check`)

| check | pass | fix |
|---|---|---|
| final hit | `music import` / `cues` report `alignmentError.final` ≈ 0 (±50 ms) | `--target`, or `cues.json` `manual.final` |
| balance | voice ~13.5 dB above music while speaking (±2) | `music mix` |
| loudness | −14 LUFS integrated, ≤ −1 dBTP (applied at export, linear gain) | automatic |

## Picture (`layout`, stills, contact sheets)

| check | pass | fix |
|---|---|---|
| clipping | nothing cut off at the frame edge (2-unit tolerance) | scene layout |
| vertical safe zone | text within y 250–1750 | scene `vert` layout |
| overlaps | warnings only — no text covered | judge on the still |
| readability | sizes per `layout.md`, at 720p | scene layout |
| art sharpness | `art check` clean for the largest output size | re-process `--max`, or regenerate `--hires=true` |
| QR | decodes to `theme.json` `endCard.qrUrl` on a rendered frame | `art qr`, size/quiet zone in the end-card scene |
| engine change | stills differ by ≤ 8/255 per channel (GPU text noise) | — |

## Export (`qa`)

| check | pass | fix |
|---|---|---|
| duration / size / fps | match `promo.json` output | re-export |
| audio vs video length | within 0.1 s | re-export |
| loudness | −14 ± 1 LUFS, true peak ≤ −0.8 dBTP | re-export; persistent → music mix |

The report lands in `out/qa_report.md` and `.json`.
