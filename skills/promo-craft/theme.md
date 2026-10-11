# Theme (`theme.json`)

| field | what |
|---|---|
| `name` | product name (window title, default logo text) |
| `palette` | colours by role (below); any CSS colour |
| `fonts` | font stacks for the four text roles: `marker` (titles, captions), `hand` (handwriting), `display` (logo, numbers, stamps, badges; `orb` is an old alias), `inter` (UI labels) |
| `fontFiles` | extra fonts to embed: `[{ "family": "Brand Sans", "file": "assets/fonts/brand.woff2", "weight": "400 700" }]` — then use the family in `fonts` |
| `logo` | `{ "type": "text", "text": "DemoProduct", "color": "#1B1F2A", "font": "display", "weight": 900 }` (a paper cut-out sticker of the name; `color` defaults to `ink`) or `{ "type": "image", "image": "<manifest key>" }` |
| `endCard` | `qrUrl`, `website`, `badges` (manifest keys), `tagline` |
| `brandWords` | lower-case brand words, for voice QA |
| `spoken` | `{ "<regex>": "<canonical>" }` spoken-form mappings for voice QA |
| `characters` | extra stick-figure looks: `{ "founder": { "hair": "messy", "hairColor": "#333", "shirtColor": "teal", "bottom": "pants", "bottomColor": "navy" } }` |
| `constants` | any per-video data scenes read (`THEME.constants.price`) |

## Palette roles

The engine's palette keys keep their names whatever the brand; map the brand onto their **roles**:

| key | role |
|---|---|
| `ink` | outlines and default text |
| `paper` | the frame background under everything |
| `accent` | **primary brand accent**: highlights, glows, data values, sunbursts, badges, confetti |
| `accentDeep` | darker accent: stamps, icons on light backgrounds |
| `navy`, `navy2` | dark brand surfaces: end card, data tags, phone screens, swipes |
| `teal`, `cyan`, `orange`, `coral`, `yellow`, `lime`, `pink`, `red` | secondary accents (check marks = teal, crosses = red, confetti mixes several) |
| `sky`, `sky2`, `blue1`–`blue3`, `sand`, `green`, `sun`, `wood`, `woodDark`, `kraft`, `cream`, `charcoal`, `surface`, `white`, `skin` | scenery and materials |

Keep `ink` dark and `paper` light (the collage reads as ink on paper). Contrast check: text colour vs what it sits on, at least 4.5:1.
