import { ELLIPSIS, FALLBACK, LETTER_GAP, glyph, hasGlyph } from "./font";

/**
 * Text for the pixel font: what to do with characters it cannot draw, how wide a string is, and
 * how to cut one to a width. All pure; widths are in art pixels.
 */

// Each group folds to its first letter. Capitals are handled by lowering the character first.
const FOLDS = [
  "aàáảãạăằắẳẵặâầấẩẫậäåā",
  "eèéẻẽẹêềếểễệëē",
  "iìíỉĩịïîī",
  "oòóỏõọôồốổỗộơờớởỡợöøō",
  "uùúủũụưừứửữựüûū",
  "yỳýỷỹỵÿ",
  "dđ",
  "cç",
  "nñ",
];
const FOLDED = new Map<string, string>();
for (const group of FOLDS) {
  for (const char of group.slice(1)) FOLDED.set(char, group[0]!);
}
const PUNCTUATION: Readonly<Record<string, string>> = {
  "‘": "'",
  "’": "'",
  "“": '"',
  "”": '"',
  "–": "-",
  "—": "-",
  "→": "->",
  "×": "x",
  "·": ".",
  "•": "*",
};

const isCombiningMark = (char: string) => char >= "̀" && char <= "ͯ";
const isSpace = (char: string) => /\s/.test(char);

function foldChar(char: string): string | null {
  if (hasGlyph(char) && char !== FALLBACK) return char;
  if (PUNCTUATION[char] !== undefined) return PUNCTUATION[char]!;
  const lower = char.toLowerCase();
  const base = FOLDED.get(lower);
  if (base === undefined) return null;
  return lower === char ? base : base.toUpperCase();
}

/**
 * Rewrites text into characters the font has. Accented Latin letters, Vietnamese included, become
 * their base letter; whitespace runs become one space; a run of anything else becomes one fallback
 * mark, so an emoji or a line of Chinese shows as a single block instead of a row of them.
 */
export function foldText(text: string): string {
  let out = "";
  for (const char of text) {
    if (isCombiningMark(char)) continue;
    if (isSpace(char)) {
      if (out !== "" && !out.endsWith(" ")) out += " ";
      continue;
    }
    const folded = foldChar(char);
    if (folded !== null) out += folded;
    else if (!out.endsWith(FALLBACK)) out += FALLBACK;
  }
  return out.trimEnd();
}

function measure(folded: string): number {
  let width = 0;
  for (const char of folded) width += glyph(char).width + LETTER_GAP;
  return width === 0 ? 0 : width - LETTER_GAP;
}

/** Width of `text` once folded, in art pixels. */
export function textWidth(text: string): number {
  return measure(foldText(text));
}

/** Already-folded text, cut short with an ellipsis when it is wider than `maxWidth`. */
function cut(folded: string, maxWidth: number): string {
  if (measure(folded) <= maxWidth) return folded;
  const chars = Array.from(folded);
  while (chars.length > 0) {
    chars.pop();
    const shorter = `${chars.join("").trimEnd()}${ELLIPSIS}`;
    if (measure(shorter) <= maxWidth) return shorter;
  }
  return measure(ELLIPSIS) <= maxWidth ? ELLIPSIS : "";
}

/** `text` folded and, when it is wider than `maxWidth`, cut short with an ellipsis. */
export function fitText(text: string, maxWidth: number): string {
  return cut(foldText(text), maxWidth);
}

/** The longest run of characters from the start of `word` that fits; at least one. */
function head(word: string, maxWidth: number): string {
  const chars = Array.from(word);
  let count = 1;
  while (count < chars.length && measure(chars.slice(0, count + 1).join("")) <= maxWidth) count++;
  return chars.slice(0, count).join("");
}

/**
 * `text` folded and wrapped at spaces into at most `maxLines` lines no wider than `maxWidth`. A
 * word too long for a line is broken; whatever does not fit ends the last line with an ellipsis.
 */
export function wrapText(text: string, maxWidth: number, maxLines = 1): string[] {
  const words = foldText(text).split(" ").filter(Boolean);
  const lines: string[] = [];
  let next = 0;
  while (next < words.length && lines.length < maxLines) {
    if (lines.length === maxLines - 1) {
      lines.push(cut(words.slice(next).join(" "), maxWidth));
      break;
    }
    const word = words[next]!;
    if (measure(word) > maxWidth) {
      const piece = head(word, maxWidth);
      lines.push(piece);
      words[next] = word.slice(piece.length);
      continue;
    }
    let line = word;
    next++;
    while (next < words.length && measure(`${line} ${words[next]}`) <= maxWidth) line += ` ${words[next++]}`;
    lines.push(line);
  }
  return lines.filter((line) => line !== "");
}

/**
 * Stamps already-folded text into `pixels` (row-major, `stride` wide) with its top left at
 * (`left`, `top`), writing `value` for ink. The text takes `FONT_HEIGHT` rows.
 */
export function stampText(
  pixels: Uint8Array,
  stride: number,
  folded: string,
  left: number,
  top: number,
  value: number,
): void {
  let x = left;
  for (const char of folded) {
    const { width, rows } = glyph(char);
    rows.forEach((line, y) => {
      for (let column = 0; column < width; column++) {
        if (line[column] === "#") pixels[(top + y) * stride + x + column] = value;
      }
    });
    x += width + LETTER_GAP;
  }
}
