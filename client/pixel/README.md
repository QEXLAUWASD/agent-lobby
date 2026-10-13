# client/pixel

The pixel-art renderer for the Crew office: sprites drawn as code, a palette taken from the Paseo
theme, and a PNG encoder that turns the two into images without canvas, DOM or assets.

## Art and licence

Every sprite here is original and is drawn in this directory as text grids, one character per
pixel. Nothing was copied or traced from another project; no third-party asset is bundled. The art
is covered by this repository's licence.

## How a sprite reaches the screen

1. A drawing function (`character`, `prop`, `tile`, `emote`, `composite`) returns a `Bitmap`: palette
   slot indices, a size and an anchor. Bitmaps do not depend on the theme and are cached by key.
2. `officePalette(theme)` gives one colour per slot. Floor, walls and status colours come from the
   theme; skin, hair and clothing are fixed.
3. `<Sprite sprite palette scale />` encodes the bitmap as a PNG data URI at device resolution
   (`scale × ceil(PixelRatio)`) and shows it in one `Image` at `scale` layout pixels per sprite
   pixel. Encoding at layout size instead blurs on any dense screen.

`Sprite` holds no state and never animates. Callers choose the frame; frame 0 of every pose is the
still to show under reduced motion.

## Sizes and anchors

A tile is 16 px (`TILE`). Anchors are in sprite pixels from the top left.

| Sprite | Size | Anchor | Frames |
| --- | --- | --- | --- |
| character | 16 × 24 | 8, 24 (under the feet) | idle 2, walk 4, sit 2, sleep 2 |
| desk | 32 × 28 | 16, 28; the monitor is the top 12 rows | lit 2, off 1, error 1 |
| chair | 16 × 16 | 8, 16 | 1 |
| plant, coffee, water | 16 × 19 to 22 | bottom centre | 1 |
| sofa | 32 × 20 | bottom centre | 1 |
| envelope | 12 × 9 | bottom centre | 1 |
| emote | 12 × 12 | 6, 12 (tip of the tail) | zzz 2, thinking 4, others 1 |
| floor, floorAlt, wall, wallCap | 16 × 16 | 0, 0 | 1 |
| bubble | text width + chrome (9 to `maxWidth`, default 120) × 15 | `tailX`, 15 (tip of the tail) | 1 |

Put a character's anchor on the bottom centre of the tile it stands or sits on. A seated character
facing up carries the chair's back in its own drawing, so the order chair, desk, character is right
for every pose. `sit` facing up is the typing pose; its two frames are the keystrokes. `sleep`
ignores facing.

Roles differ in outline, not only colour: the overseer has a brimmed hat and a cape, the nexus a
headset with an antenna, a meow cat ears and a tail, a plain agent none of these. `lookFor(agentId)`
picks skin, hair, hair style, shirt and trousers, the same every time for the same id.

## Speech bubbles and the font

`bubble({ text, tone, status?, maxWidth?, tailX? })` returns one bitmap with the words drawn in, so
a bubble of any length is one image. `bubbleWidth(spec)` gives its width without drawing, for
placing it; pass the speaker's offset back as `tailX` and the tail keeps pointing at them when the
bubble is pushed in from an edge. One line only.

| Tone | Shape | Icon | Fill |
| --- | --- | --- | --- |
| say | rounded | none | paper |
| tool | square | prompt while running, check when completed, dash when canceled, cross when failed | dark screen; danger when failed |
| tell | rounded | arrow | accent |
| ask | rounded | ? | warning |
| alert | rounded | ! | danger |

The font is 5 × 7 with two rows of descender and proportional widths: ASCII letters, digits and
punctuation, an ellipsis, four icons and a fallback block. At scale 2 a capital is 14 layout pixels
tall; a 3 × 5 face would be 10 and was judged too small for a phone-width pane. 120 art pixels hold
about 20 characters.

`foldText` rewrites text into what the font has: accented Latin letters, Vietnamese included,
become their base letter (đ → d), whitespace runs become one space, and a run of anything else
(emoji, CJK) becomes a single fallback block. `textWidth` measures in art pixels and
`fitText(text, maxWidth)` cuts with an ellipsis. `bubble` does both itself.

## Caches

Every cache is bounded. Drawings and images dropped from one are made again on the next request.

| Cache | Bound |
| --- | --- |
| character bitmaps | 1024 most recently used (about 0.4 MB) |
| room composites | 32 most recently used, and 8 million pixels in total |
| bubbles | 256 most recently used |
| data URIs | 1024 most recently used, and 6 million characters in total |
| props, tiles, emotes | the fixed set of drawings: 24 |
| palettes | one per theme object, held weakly |

Use `composite` to flatten a room's floor, walls and furniture into one bitmap, so the backdrop
costs one image instead of one per tile.
