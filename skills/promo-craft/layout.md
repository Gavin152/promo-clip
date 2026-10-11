# Layout per format

## Design spaces

| format | layout key | design space | 1080p output |
|---|---|---|---|
| 16:9 landscape | `land` | 1920 x 1080 | 1920 x 1080 |
| 9:16 vertical | `vert` | 1260 x 2240 | 1080 x 1920 |
| 1:1 square | `sq` | 1260 x 1260 | 1080 x 1080 |

Scenes always draw in design units; every output size (720p … 4K) is the same picture scaled. A custom size (e.g. 4:5 = 1080 x 1350) uses the nearest layout scaled to cover and centre-cropped — up to 10 % per edge — so keep text at least 130 units from the cropped edges of square and vertical layouts.

## Safe zone

Vertical: **text stays within y 250–1750** (Reels/TikTok/Shorts UI covers the top and bottom). Decorative stickers, backdrops and characters may bleed past it. `layout` fails on text outside it and on anything cut off at the frame edge.

## Sizes that read on a phone

Design units, minimum: titles 100 (`slam`), captions 56 landscape / 64 vertical and square, data values 48, small labels 26. Characters: 450+ tall in landscape, 600+ in vertical. A QR code: 260+ wide (landscape), 380+ (vertical).

## Re-composing for another format

Re-compose rather than scale:

- **Landscape rows → vertical stacks.** Title top third, hero in the middle, supporting stickers below it; square sits between the two (often a 2 x 2 grid).
- **Groups that move together** (a chart with its route and pins, a phone with its overlay) keep their primary coordinates inside `grp(ctx, [dx, dy, s], fn)`; the layout entry holds only `[dx, dy, s]`.
- `backdrop()` is cover-fit in every format — move its focus (`fx`, `fy`) so the important part stays in frame.
- `art()` anchors bottom-centre: in a taller frame raise y so a character stands on something rather than floating mid-frame.
- `flip: true` mirrors everything in the image, lettering included (a clapperboard, a shirt print) — flip only art without text, or ask the art stage for a second pose.
- Leave the primary layout exactly as it was; the formats stage checks that its stills are unchanged.

## Composition

- One focal point per moment; enter elements one by one on their words rather than all at once.
- Use the whole frame: an empty half reads as a mistake in 16:9; in 9:16 the middle band carries the story.
- Overlap is a collage feature (stickers on stickers) as long as no text is covered.
- Hidden elements stay hidden: gate draws on `k > 0` (`pop`, `ease.outBack` return exact 0 before their start).
