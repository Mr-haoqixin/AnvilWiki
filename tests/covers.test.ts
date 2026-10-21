/**
 * Pure-helper tests for `pnpm gen-covers` (src/lib/covers.ts).
 * Rendering itself (satori/resvg/CJK download) is exercised by running the
 * script — these pin the deterministic logic only.
 */
import { describe, expect, test } from 'vitest';
import {
  COVER_FORMAT,
  coverBrandLine,
  coverBrandName,
  coverFilename,
  coverFontScript,
  frontmatterImage,
  hasCjk,
  hexToHsl,
  hslToHex,
  isStaleCoverRef,
  parseBrandHsl,
  pickCjkScript,
  pickFontSize,
  replaceImageInFrontmatter,
  spliceImageIntoFrontmatter,
  stableHash,
  stripEmoji,
  subsetText,
  titleWidthUnits,
} from '~/lib/covers';

describe('parseBrandHsl / hslToHex', () => {
  test('parses the light-mode --brand declaration', () => {
    const css = ':root {\n  --brand: 22 90% 52%;\n  --brand-light: 22 90% 62%;\n}';
    expect(parseBrandHsl(css)).toEqual({ h: 22, s: 90, l: 52 });
  });

  test('returns null when --brand is missing', () => {
    expect(parseBrandHsl(':root { --brand-light: 22 90% 62%; }')).toBeNull();
  });

  test('hslToHex matches known values', () => {
    expect(hslToHex(0, 100, 50)).toBe('#ff0000');
    expect(hslToHex(0, 0, 100)).toBe('#ffffff');
    expect(hslToHex(0, 0, 0)).toBe('#000000');
  });
});

describe('hexToHsl', () => {
  test('matches the reference values apply-template has always produced', () => {
    // Pinned against the previous inline implementation in apply-template.ts
    // (math was ported verbatim) — these feed globals.css + manifest.
    expect(hexToHsl('#f97316')).toEqual({ h: 25, s: 95, l: 53 });
    expect(hexToHsl('#ff0000')).toEqual({ h: 0, s: 100, l: 50 });
    expect(hexToHsl('#000000')).toEqual({ h: 0, s: 0, l: 0 });
    expect(hexToHsl('#ffffff')).toEqual({ h: 0, s: 0, l: 100 });
  });

  test('expands #rgb shorthand and accepts uppercase', () => {
    expect(hexToHsl('#abc')).toEqual(hexToHsl('#aabbcc'));
    expect(hexToHsl('#F97316')).toEqual(hexToHsl('#f97316'));
  });

  test('rejects malformed input with null', () => {
    expect(hexToHsl('nothex')).toBeNull();
    expect(hexToHsl('#12345')).toBeNull();
    expect(hexToHsl('#1234g6')).toBeNull();
    expect(hexToHsl('')).toBeNull();
  });
});

describe('spliceImageIntoFrontmatter', () => {
  test('inserts after category on LF files, byte-identical EOL', () => {
    const src = "---\ntitle: T\ncategory: bosses\ndescription: D\n---\n\nBody";
    const out = spliceImageIntoFrontmatter(src, '../../assets/covers/x.png');
    expect(out).toBe(
      "---\ntitle: T\ncategory: bosses\nimage: '../../assets/covers/x.png'\ndescription: D\n---\n\nBody",
    );
    expect(out!.includes('\r')).toBe(false);
  });

  test('keeps a CRLF page uniformly CRLF (no mixed EOL, no doubled CR)', () => {
    const src = '---\r\ntitle: T\r\ncategory: bosses\r\ndescription: D\r\n---\r\n\r\nBody';
    const out = spliceImageIntoFrontmatter(src, 'c.png');
    expect(out).toContain("category: bosses\r\nimage: 'c.png'\r\n");
    expect(out).toContain('\r\n---\r\n');
    expect(out!.includes('\r\r')).toBe(false);
    // Uniform CRLF: after removing CRLF pairs, no bare LF remains.
    expect(out!.replace(/\r\n/g, '').includes('\n')).toBe(false);
  });

  test('$-sequences in frontmatter text survive the splice unchanged', () => {
    // String-mode replace would expand these: `$'` drags the document tail
    // into the frontmatter, `$1` repeats the whole old block, `$$` silently
    // loses a dollar — all without failing the build.
    const src = "---\ntitle: Cost $1 $' $$ 5\ncategory: bosses\n---\n\nBody text";
    const out = spliceImageIntoFrontmatter(src, 'c.png');
    expect(out).toBe("---\ntitle: Cost $1 $' $$ 5\ncategory: bosses\nimage: 'c.png'\n---\n\nBody text");
  });

  test('falls back to description, then appends when neither exists', () => {
    expect(spliceImageIntoFrontmatter('---\ntitle: T\ndescription: D\n---\n', 'c.png')).toBe(
      "---\ntitle: T\ndescription: D\nimage: 'c.png'\n---\n",
    );
    expect(spliceImageIntoFrontmatter('---\ntitle: T\n---\n', 'c.png')).toBe(
      "---\ntitle: T\nimage: 'c.png'\n---\n",
    );
  });

  test('returns null without frontmatter or when an image already exists', () => {
    expect(spliceImageIntoFrontmatter('no frontmatter here', 'c.png')).toBeNull();
    expect(spliceImageIntoFrontmatter("---\nimage: a.png\n---\n", 'c.png')).toBeNull();
  });
});

describe('frontmatterImage / isStaleCoverRef / replaceImageInFrontmatter', () => {
  test('reads a relative image path and ignores absolute URLs', () => {
    expect(frontmatterImage("---\nimage: '../../assets/covers/x.webp'\n---\n")).toBe(
      '../../assets/covers/x.webp',
    );
    expect(frontmatterImage('---\nimage: "https://cdn.example.com/a.png"\n---\n')).toBeNull();
    expect(frontmatterImage('---\ntitle: T\n---\n')).toBeNull();
  });

  test('a leftover .png of the same cover is stale (must be re-pointed)', () => {
    const src = "---\ntitle: T\nimage: '../../assets/covers/en-tasks-x.png'\n---\n";
    expect(isStaleCoverRef(src, 'en-tasks-x.webp')).toBe(true);
  });

  test('hand-made cover art under another name is NOT stale', () => {
    // A fork's own illustration must never be overwritten by the generator.
    const src = "---\ntitle: T\nimage: '../../assets/covers/my-art.png'\n---\n";
    expect(isStaleCoverRef(src, 'en-tasks-x.webp')).toBe(false);
  });

  test('a matching reference is not stale', () => {
    const src = "---\ntitle: T\nimage: '../../assets/covers/en-tasks-x.webp'\n---\n";
    expect(isStaleCoverRef(src, 'en-tasks-x.webp')).toBe(false);
  });

  test('replaceImageInFrontmatter rewrites the path and keeps EOL style', () => {
    const lf = "---\ntitle: T\nimage: 'old.png'\n---\n\nBody";
    expect(replaceImageInFrontmatter(lf, 'new.webp')).toBe(
      "---\ntitle: T\nimage: 'new.webp'\n---\n\nBody",
    );
    const crlf = "---\r\ntitle: T\r\nimage: 'old.png'\r\n---\r\n\r\nBody";
    const out = replaceImageInFrontmatter(crlf, 'new.webp');
    expect(out).toContain("image: 'new.webp'\r\n");
    expect(out!.includes('\r\r')).toBe(false);
  });

  test('replaceImageInFrontmatter returns null without an image line', () => {
    expect(replaceImageInFrontmatter('---\ntitle: T\n---\n', 'new.webp')).toBeNull();
    expect(replaceImageInFrontmatter('no frontmatter', 'new.webp')).toBeNull();
  });
});

describe('CJK detection', () => {
  test('hasCjk flags Han and kana, not Latin', () => {
    expect(hasCjk('Emberfang ボス攻略')).toBe(true);
    expect(hasCjk('完全ガイド')).toBe(true);
    expect(hasCjk('Plain English title')).toBe(false);
  });

  test('ja locale or kana picks JP glyph shapes; other Han picks SC', () => {
    expect(pickCjkScript('ja', '完全ガイド')).toBe('ja');
    expect(pickCjkScript('en', '火の玉')).toBe('ja'); // の is kana → JP glyphs
    expect(pickCjkScript('en', 'Anvil Quest')).toBeNull();
  });

  test('kana in text forces ja even on non-ja locale', () => {
    expect(pickCjkScript('en', 'ボス攻略')).toBe('ja');
    expect(pickCjkScript('en', '武器强度排行')).toBe('zh');
  });
});

describe('coverBrandLine', () => {
  test('uppercases and turns plain spaces into no-break spaces', () => {
    // satori drops a space that follows a CJK run — the Latin word would
    // overlap the last Han glyph. U+00A0 survives shaping.
    const line = coverBrandLine('格林默威克 Wiki');
    expect(line).toBe('格林默威克\u00A0WIKI');
    expect(line.includes('\u00A0')).toBe(true);
    expect(line.includes(' ')).toBe(false);
  });

  test('Latin-only names keep their space (still a no-break space)', () => {
    expect(coverBrandLine('AQ Wiki')).toBe('AQ WIKI');
  });
});

describe('coverBrandName', () => {
  test('uses the LOCALE own shortName, not the global one', () => {
    // The Chinese wordmark on an English/German cover was unreadable for
    // exactly the readers of that page.
    const perLocale = { en: 'Glimmerwick Wiki', de: 'Glimmerwick Wiki', zh: '格林默威克 Wiki' };
    expect(coverBrandName('en', perLocale, '格林默威克 Wiki')).toBe('Glimmerwick Wiki');
    expect(coverBrandName('de', perLocale, '格林默威克 Wiki')).toBe('Glimmerwick Wiki');
    expect(coverBrandName('zh', perLocale, '格林默威克 Wiki')).toBe('格林默威克 Wiki');
  });

  test('falls back to the global shortName for an unknown locale', () => {
    expect(coverBrandName('ko', {}, '格林默威克 Wiki')).toBe('格林默威克 Wiki');
  });
});

describe('coverFontScript', () => {
  test('picks the font from ALL cover strings, not just the title', () => {
    // Latin title + Han brand line: the brand is drawn on every cover, so a
    // CJK font is required even though the title alone needs none.
    expect(pickCjkScript('en', 'Abigailia: Prologue Headmistress')).toBeNull();
    expect(coverFontScript('en', ['Abigailia: Prologue Headmistress', '格林默威克 Wiki'])).toBe('zh');
  });

  test('no CJK anywhere → no CJK font', () => {
    expect(coverFontScript('en', ['Abigailia: Prologue Headmistress', 'AQ Wiki'])).toBeNull();
  });

  test('ja locale and kana still win over SC', () => {
    expect(coverFontScript('ja', ['ボス攻略', '格林默威克 Wiki'])).toBe('ja');
    expect(coverFontScript('en', ['古代神殿', '格林默威克'])).toBe('zh');
  });
});

describe('stripEmoji', () => {
  test('strips pictographs but keeps text', () => {
    expect(stripEmoji('Fire Titan ⚔️🔥')).toBe('Fire Titan');
    expect(stripEmoji('No emoji here')).toBe('No emoji here');
  });
});

describe('naming / hashing / subsetting', () => {
  test('coverFilename flattens the content id', () => {
    expect(coverFilename('en/bosses/emberfang')).toBe('en-bosses-emberfang.webp');
    expect(coverFilename('ja/guides/beginner-guide')).toBe('ja-guides-beginner-guide.webp');
  });

  test('covers are WebP — a cover library must not fill the git repo', () => {
    expect(COVER_FORMAT).toBe('webp');
  });

  test('stableHash is deterministic and hash-like', () => {
    expect(stableHash('abc')).toBe(stableHash('abc'));
    expect(stableHash('abc')).not.toBe(stableHash('abd'));
    expect(stableHash('abc')).toMatch(/^[0-9a-f]{8}$/);
  });

  test('subsetText dedupes and sorts glyphs', () => {
    expect(subsetText('abc', 'cbd')).toBe('abcd');
  });
});

describe('font sizing heuristics', () => {
  test('CJK chars count as full width, Latin as narrow', () => {
    expect(titleWidthUnits('ああ')).toBeGreaterThan(titleWidthUnits('aa'));
  });

  test('short titles get the max size, very long titles clamp to the floor', () => {
    expect(pickFontSize('Fire Titan')).toBe(84);
    const veryLong = 'x'.repeat(200);
    expect(pickFontSize(veryLong)).toBe(36);
  });
});
