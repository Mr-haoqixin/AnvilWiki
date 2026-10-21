/**
 * Pure helpers for `pnpm gen-covers` (og:image cover generation, v2.0).
 *
 * Framework-free on purpose: the script (scripts/gen-covers.ts) and the unit
 * tests (tests/covers.test.ts) both import from here; nothing in src/ renders
 * at runtime — covers are build-time assets.
 */

export interface BrandHsl {
  h: number;
  s: number;
  l: number;
}

/**
 * Parse the light-mode `--brand: H S% L%;` declaration out of globals.css.
 * The brand color is the single source of truth for theming — covers must
 * read it from there instead of hardcoding hex values.
 */
export function parseBrandHsl(css: string): BrandHsl | null {
  const m = css.match(/--brand:\s*(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)%\s+(\d+(?:\.\d+)?)%/);
  return m ? { h: Number(m[1]), s: Number(m[2]), l: Number(m[3]) } : null;
}

export function hslToHex(h: number, s: number, l: number): string {
  const sn = s / 100;
  const ln = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = sn * Math.min(ln, 1 - ln);
  const f = (n: number) => {
    const v = ln - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return Math.round(v * 255)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

/**
 * Inverse of hslToHex for user-supplied hex (#rgb / #rrggbb, case-insensitive).
 * Returns null on malformed input — CLI callers own the friendly error + exit.
 * Keep the math byte-equivalent with the copy that used to live inline in
 * scripts/apply-template.ts: its output feeds globals.css and the PWA manifest,
 * and a rounding change would visibly shift every fork's theme color.
 */
export function hexToHsl(hex: string): BrandHsl | null {
  let h = hex.replace('#', '').toLowerCase();
  if (/^[0-9a-f]{6}$/.test(h)) {
    // already expanded
  } else if (/^[0-9a-f]{3}$/.test(h)) {
    h = h
      .split('')
      .map((c) => c + c)
      .join('');
  } else {
    return null;
  }
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let s = 0;
  let hue = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        hue = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        hue = (b - r) / d + 2;
        break;
      default:
        hue = (r - g) / d + 4;
    }
    hue *= 60;
  }
  return { h: Math.round(hue), s: Math.round(s * 100), l: Math.round(l * 100) };
}

/**
 * Splice `image: '<path>'` into MDX frontmatter text (pure — file IO lives in
 * the script). Preserves the file's EOL style so a CRLF page doesn't come out
 * with mixed line endings, which `pnpm sync-codes` loudly rejects. Returns
 * null when there's no frontmatter or an image is already wired.
 */
export function spliceImageIntoFrontmatter(src: string, imageRelPath: string): string | null {
  const fmRe = /^---\r?\n([\s\S]*?)\r?\n---/;
  const m = src.match(fmRe);
  if (!m || /^image:/m.test(m[1])) return null;
  const block = m[1];
  const eol = block.includes('\r\n') ? '\r\n' : '\n';
  const line = `image: '${imageRelPath}'`;
  // [^\r\n] keeps the anchor line's own terminator out of the capture — `.*`
  // would swallow a CR on CRLF files and double it when splicing with \r\n.
  // Function replacers everywhere (same $-expansion class as apply-rewrites,
  // v2.7.1): string-mode replace would expand `$&`/`$'`/`$1`/`$$` sequences
  // living in title/description text into the spliced block — a `$'` title
  // drags the document body into the frontmatter and the build stays green.
  // Pinned by covers.test.ts ($-sequence cases).
  const newBlock = /^category:[^\r\n]*$/m.test(block)
    ? block.replace(/^(category:[^\r\n]*)/m, (match) => `${match}${eol}${line}`)
    : /^description:[^\r\n]*$/m.test(block)
      ? block.replace(/^(description:[^\r\n]*)/m, (match) => `${match}${eol}${line}`)
      : `${block}${eol}${line}`;
  return src.replace(fmRe, () => `---${eol}${newBlock}${eol}---`);
}

const CJK_RE = /[\u{3040}-\u{30ff}\u{31f0}-\u{31ff}\u{3400}-\u{4dbf}\u{4e00}-\u{9fff}\u{f900}-\u{faff}]/u;
const KANA_RE = /[\u{3040}-\u{30ff}]/u;

/**
 * The `image:` value in an article's frontmatter, or null when it has none.
 * Only relative asset paths count — an absolute URL is a hand-written
 * external image and must never be rewritten.
 */
export function frontmatterImage(src: string): string | null {
  const fmRe = /^---\r?\n([\s\S]*?)\r?\n---/;
  const m = src.match(fmRe);
  if (!m) return null;
  const im = m[1].match(/^image:[ \t]*['"]?([^'"\r\n]+?)['"]?[ \t]*$/m);
  if (!im) return null;
  const value = im[1].trim();
  if (!value || /^[a-z]+:\/\//i.test(value)) return null;
  return value;
}

/**
 * True when the frontmatter points at the SAME cover in another format — e.g.
 * a leftover `.png` from before covers became WebP. Such an article must be
 * re-pointed at the new file instead of being skipped as "already covered".
 *
 * Only a same-basename match counts: a differently named file is hand-made
 * cover art (a fork's own illustration), which this script must never
 * overwrite.
 */
export function isStaleCoverRef(src: string, expectedFile: string): boolean {
  const current = frontmatterImage(src);
  if (!current) return false;
  const file = current.split('/').pop() ?? '';
  if (file === expectedFile) return false;
  const stem = (f: string) => f.replace(/\.[^.]+$/, '');
  return stem(file) === stem(expectedFile);
}

/**
 * Rewrite an article's `image:` to point at the given relative path.
 * Returns null when there is no frontmatter or no image line to replace.
 */
export function replaceImageInFrontmatter(src: string, imageRelPath: string): string | null {
  const fmRe = /^---\r?\n([\s\S]*?)\r?\n---/;
  const m = src.match(fmRe);
  if (!m || !/^image:/m.test(m[1])) return null;
  const block = m[1];
  const eol = block.includes('\r\n') ? '\r\n' : '\n';
  const newBlock = block.replace(/^image:[^\r\n]*$/m, () => `image: '${imageRelPath}'`);
  return src.replace(fmRe, () => `---${eol}${newBlock}${eol}---`);
}

export function hasCjk(text: string): boolean {
  return CJK_RE.test(text);
}

/**
 * Which Noto CJK variant the glyphs need: Japanese locale or kana in the
 * text → JP glyph shapes; otherwise Han → SC. Returns null when no CJK.
 */
export function pickCjkScript(locale: string, text: string): 'ja' | 'zh' | null {
  if (!hasCjk(text)) return null;
  if (locale.toLowerCase().startsWith('ja') || KANA_RE.test(text)) return 'ja';
  return 'zh';
}

/**
 * The brand line printed in the cover's top-left corner.
 *
 * Uppercased (it reads as a wordmark) and with every plain space turned into
 * a no-break space: satori drops a space that directly follows a CJK run, so
 * "格林默威克 WIKI" would render with the W overlapping the last Han glyph.
 */
export function coverBrandLine(shortName: string): string {
  return shortName.toUpperCase().replace(/ /g, '\u00A0');
}

/**
 * The brand name a cover shows, per locale.
 *
 * Every locale JSON already carries its own `site.shortName` ("Glimmerwick
 * Wiki" for en/de/es/fr/ja/nl/pt/ru, the Chinese name for zh/zh-hant), so
 * the cover must use THAT locale's value — printing the Chinese wordmark on
 * an English or German cover showed readers a brand they cannot read.
 *
 * Falls back to the global site.shortName when a locale has no entry.
 */
export function coverBrandName(
  locale: string,
  perLocaleShortNames: Record<string, string | undefined>,
  fallback: string,
): string {
  return perLocaleShortNames[locale] ?? fallback;
}

/**
 * Which CJK font a cover needs — decided from EVERY string the cover shows,
 * not just the title.
 *
 * The brand line (site.shortName) and the game name are rendered on every
 * cover, so a Han brand name ("格林默威克 Wiki") needs a CJK font even when
 * the article title is pure Latin. Deciding from the title alone loaded only
 * Lato for those covers, and satori then drew the Han brand glyphs from
 * Lato's .notdef — a box-with-question-mark per character (the "????? WIKI"
 * tofu in the top-left corner).
 *
 * Kana anywhere → JP glyph shapes; otherwise Han → SC. The title still wins
 * on locale (a ja article keeps JP shapes even if the brand is Han).
 */
export function coverFontScript(
  locale: string,
  texts: readonly string[],
): 'ja' | 'zh' | null {
  const joined = texts.join('');
  if (!hasCjk(joined)) return null;
  if (locale.toLowerCase().startsWith('ja') || KANA_RE.test(joined)) return 'ja';
  return 'zh';
}

/**
 * satori ships no emoji font (emoji render as images there, not glyphs) —
 * strip pictographs from cover text. The caller warns when this changes it.
 */
export function stripEmoji(text: string): string {
  return text.replace(/[\p{Extended_Pictographic}\u{FE0F}]/gu, '').trim();
}

/** Cover file format — WebP, not PNG: a 1200×675 cover is ~7 KB as WebP vs
 *  ~160 KB as PNG (the flat gradient + text compresses far better), which
 *  keeps 800+ committed covers out of git's way and out of the Pages file
 *  budget. resvg only rasterizes to PNG, so the script pipes PNG → sharp. */
export const COVER_FORMAT = 'webp';

/** Cover filename from a content id: "en/bosses/emberfang" → "en-bosses-emberfang.webp". */
export function coverFilename(entryId: string): string {
  return (
    entryId
      .split('/')
      .filter(Boolean)
      .join('-') + `.${COVER_FORMAT}`
  );
}

/** Estimated rendered width in em units (CJK ≈ 1em, most Latin ≈ 0.55em). */
export function titleWidthUnits(title: string): number {
  let units = 0;
  for (const ch of title) units += CJK_RE.test(ch) ? 1 : 0.55;
  return units;
}

/**
 * Title font size that keeps the title within ~2 lines of the 1008px text
 * column (1200px canvas − 2×72 padding − 48 for the brand bar). Long titles
 * shrink instead of overflowing — satori has no auto-fit.
 */
export function pickFontSize(title: string): number {
  const units = Math.max(titleWidthUnits(title), 1);
  return Math.max(36, Math.min(84, Math.round((2 * 1008) / units)));
}

/** FNV-1a 32-bit hash, hex-encoded — manifest key, stable across runs. */
export function stableHash(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/**
 * The exact glyph set to keep when subsetting a CJK font: every unique
 * character across all strings that will appear on the cover. Full CJK
 * fonts are ~16MB; a per-title subset is typically 60–200KB.
 */
export function subsetText(...parts: string[]): string {
  return [...new Set(parts.join(''))].sort().join('');
}
