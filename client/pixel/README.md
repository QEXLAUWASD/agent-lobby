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
   (`round(scale × PixelRatio)` device pixels per art pixel) and shows it in one `Image` at `scale`
   layout pixels per art pixel. Encoding at layout size instead blurs on any dense screen.

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
| fridge | 16 × 27 | bottom centre | 1 |
| counter (with sink) | 32 × 13 | bottom centre | 1 |
| table (standing) | 16 × 16 | bottom centre | 1 |
| bookshelf | 32 × 28 | bottom centre | 1 |
| lowTable | 16 × 7 | bottom centre | 1 |
| beanbag | 16 × 12 | bottom centre | 1 |
| rug (flat, drawn right after the floor) | 32 × 16 | bottom centre | 1 |
| screenH | 16 × 10 | bottom centre | 1 |
| screenV | 4 × 22 | bottom centre | 1 |
| every `tile(id)` and `wallTop(joins)` | 16 × 16 | 0, 0 | 1 |
| door(faceRows) | 16 × 16·faceRows | 0, 0 | 1 |
| bubble | 9 to `maxWidth` (default 88) × 14, 23 or 32 | `tailX`, height (tip of the tail) | 1 |

Put a character's anchor on the bottom centre of the tile it stands or sits on. A seated character
facing up carries the chair's back in its own drawing, so the order chair, desk, character is right
for every pose. `sit` facing up is the typing pose; its two frames are the keystrokes. `sleep`
ignores facing.

Roles differ in outline, not only colour: the overseer has a brimmed hat and a cape, the nexus a
headset with an antenna, a meow cat ears and a tail, a plain agent none of these. `lookFor(agentId)`
picks skin, hair, hair style, shirt and trousers, the same every time for the same id.

## Scale

A sprite is sharp when one art pixel covers a whole number of device pixels. So the usable layout
scales are k / pixelRatio: 0.5, 1, 1.5, 2 on a 2× screen; 1, 2, 3 on a 1× screen; 0.6, 1.2, 1.8 on a
1.67× screen. `crispScale(target, pixelRatio, "down" | "up" | "nearest")` picks one, and
`deviceCrispScale(target)` does it for the device. Pass the result to `<Sprite scale>`.

Positions computed as whole art pixels times that scale land on device pixels by themselves. An
offset that is not (centring a room in its pane, say) should go through `snap`, or the whole room
sits half a device pixel off and softens. A backdrop and the sprites on it must share one scale.

## Walls and doors

`wallTop(joins)` is a wall seen from above: a solid slab, outlined and bevelled on each side that
does not join another wall tile. `wallTopAt(isWall, x, y)` reads the joins from the layout, so runs,
ends, corners, tees and crossings need no tile choice. The slab leans well toward the text colour
and is tested above 3:1 against every floor on both themes.

`wall` is the wall's front face, for the rows under a horizontal wall. `door(faceRows)` is a wooden
door for that face, one bitmap as tall as the face; the wall's top row above it stays plain wall.
`tile("doormat")` is a floor tile with a mat for just inside. `tile("partition")`, `tile("door")`
and `tile("doorway")` remain for older callers: the edgeless slab, the joined slab and `door(1)`.

## Pods

Two ways to mark a crew's area. `tile("pod0")` to `tile("pod3")` are quiet floor tints, each with
its own weave (dots, horizontal lines, vertical lines, checks). `prop("screenH")` is a low cubicle
screen along a row, 16 × 10; `prop("screenV")` runs down a column, 4 × 22, covering one tile of
depth with its end face below. Both tile end to end and are y-sorted like any prop.

## Zones and use points

The pantry is fridge, counter, coffee and water against a wall on `kitchen` tiles, with a standing
`table` out on the floor. The lounge is bookshelf and plant against a wall on `carpet` tiles, with
sofa, rug, low table and beanbag. `coffee` and `counter` share a cabinet height and join into one run.

`PROP_USES` says where a character goes to use each prop: `dx`, `dy` in tiles from the prop's
leftmost tile (`dy` 1 is the tile in front), the pose and facing, and `lift`, the art pixels to
raise a sitter so it rests on the seat. A sitter shares the prop's tile and is drawn after it.

| Prop | Use points |
| --- | --- |
| sofa | both tiles: sit, facing down, lift 4 |
| beanbag | its tile: sit, facing down, lift 3 |
| coffee, water, fridge | the tile in front: stand, facing up |
| counter, bookshelf | the two tiles in front: stand, facing up |
| table | the tile either side: stand, facing the table |
| plant, lowTable, rug | none; scenery |

`character({ carry: "cup" })` puts a cup in the hand in any pose seen from the front or side.

## Speech bubbles and the font

`bubble({ text, tone, status?, maxWidth?, maxLines?, tailX? })` returns one bitmap with the words
drawn in, so a bubble of any length is one image. The text wraps at spaces to at most `maxLines`
(default 3; a `tool` bubble is always one line) inside `maxWidth` (default 88 art pixels), and ends
with an ellipsis if it still does not fit. `bubbleSize(spec)` gives the width and height without
drawing: 14, 23 or 32 art pixels tall for one, two or three lines, tail included. Pass the
speaker's offset back as `tailX` and the tail keeps pointing at them when the bubble is pushed in
from an edge.

Bubbles are drawn at their own scale, not the room's: `bubbleScale(pixelRatio)` is the smallest
crisp scale at or above 1.4, which is 1.5 on a 2× screen, 2 on a 1× screen and 1.8 on a 1.67× one.
A capital is then 10 to 14 layout pixels tall while the room can be as small as 1×. A smaller face
was not drawn: 3 × 5 or 4 × 6 at the room's 1× would be 5 or 6 layout pixels tall.

| Tone | Shape | Icon | Fill |
| --- | --- | --- | --- |
| say | rounded | none | paper |
| tool | square | prompt while running, check when completed, dash when canceled, cross when failed | dark screen; danger when failed |
| tell | rounded | arrow | accent |
| ask | rounded | ? | warning |
| alert | rounded | ! | danger |

The font is 5 × 7 with two rows of descender and proportional widths: ASCII letters, digits and
punctuation, an ellipsis, four icons and a fallback block. 88 art pixels hold about 14 characters
a line.

`foldText` rewrites text into what the font has: accented Latin letters, Vietnamese included,
become their base letter (đ → d), whitespace runs become one space, and a run of anything else
(emoji, CJK) becomes a single fallback block. `textWidth` measures in art pixels,
`fitText(text, maxWidth)` cuts to one line with an ellipsis and `wrapText(text, maxWidth, maxLines)`
wraps. `bubble` does all of it itself.

## Caches

Every cache is bounded. Drawings and images dropped from one are made again on the next request.

| Cache | Bound |
| --- | --- |
| character bitmaps | 1024 most recently used (about 0.4 MB) |
| room composites | 32 most recently used, and 8 million pixels in total |
| bubbles | 256 most recently used |
| data URIs | 1024 most recently used, and 6 million characters in total |
| props, tiles, emotes | the fixed set of drawings: about 70, counting the 16 wall tops |
| palettes | one per theme object, held weakly |

Use `composite` to flatten a room's floor, walls and furniture into one bitmap, so the backdrop
costs one image instead of one per tile.
