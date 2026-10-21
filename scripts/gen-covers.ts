/**
 * gen-covers — generate og:image covers for wiki articles (v2.0).
 *
 * Usage:
 *   pnpm gen-covers                    # articles WITHOUT a cover (WebP + wires frontmatter)
 *   pnpm gen-covers --all              # also refresh covers this script generated before
 *   pnpm gen-covers --force            # ignore the manifest cache
 *   pnpm gen-covers --out <dir>        # render elsewhere — frontmatter is NOT touched
 *   pnpm gen-covers --fonts-dir <dir>  # offline source for Noto CJK OTFs (see below)
 *   pnpm gen-covers --only <id>        # one content id ("en/characters/abigailia");
 *                                      # repeatable for several
 *
 * Covers are 1200×675 (og:image standard since v2.0: Google Discover
 * large-image previews need ≥1200px width) rendered with satori + resvg and
 * encoded as WebP (~7 KB vs ~160 KB as PNG).
 *
 * Fonts:
 *   - Latin: bundled OFL Lato (scripts/fonts/) — deterministic, no network.
 *   - CJK: Noto Sans SC/JP. The variant is picked from EVERY string the cover
 *     shows (title + site.shortName + site.game.name) — the brand line is
 *     rendered on every cover, so a Han site.shortName needs a CJK font even
 *     for Latin titles (Lato has no Han glyphs: satori would draw its .notdef,
 *     i.e. a box-with-question-mark per character). Full OTFs (~16MB each)
 *     are NOT committed; they download once into
 *     node_modules/.cache/gen-covers/fonts/ (or use --fonts-dir with
 *     pre-downloaded files) and are subset per cover with subset-font
 *     (60–200KB per render) — satori only accepts TTF/OTF.
 *
 * Performance: the Noto OTF is loaded ONCE per run and subset per article
 * from that in-memory copy — downloading and re-reading the 16MB file for
 * every cover was the dominant cost (a full 800-article run is minutes, not
 * hours).
 *
 * Cache: <out>/.gen-covers-manifest.json maps filename → hash(title + brand +
 * size). Unchanged entries are skipped; --force regenerates everything.
 *
 * Frontmatter wiring (only when writing to the default covers dir and the
 * article has no `image:` yet): inserts `image: '<relative path>'` after the
 * `category:` line so the Zod image() helper picks the WebP up on next build.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import subsetFont from 'subset-font';
import sharp from 'sharp';
import { site } from '~/config/site';
import { displayHost } from '~/lib/site-url';
import { NOTO_BASE } from './lib/fonts';
import { loadLocalEnv } from './lib/env';
import {
  COVER_FORMAT,
  coverBrandLine,
  coverBrandName,
  coverFilename,
  coverFontScript,
  hslToHex,
  isStaleCoverRef,
  parseBrandHsl,
  pickFontSize,
  replaceImageInFrontmatter,
  spliceImageIntoFrontmatter,
  stableHash,
  stripEmoji,
  subsetText,
} from '~/lib/covers';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// Astro loads .env at build time; a standalone tsx script does not. Without
// this the cover would resolve SITE_URL differently from the site it belongs
// to (the bug class AGENTS.md rule #9 exists to prevent).
loadLocalEnv(join(root, '.env'));
const W = 1200;
const H = 675;
const CONTENT_DIR = join(root, 'src/content/wiki');
const COVERS_DIR = join(root, 'src/assets/covers');
const FONT_CACHE = join(root, 'node_modules/.cache/gen-covers/fonts');
const MANIFEST_VERSION = 2;

/**
 * The host printed in the cover's bottom-right corner.
 *
 * Resolved through the shared `~/lib/site-url` helper with the same
 * precedence the site's canonical / og:image URLs use (SITE_URL wins over
 * the `site.domain` fallback), so the cover never advertises a different
 * host than the page it links to.
 */
function coverDomain(): string {
  return displayHost(process.env.SITE_URL, site.domain);
}

// Per-locale merged CJK fonts (NotoSansCJKjp/sc, ~16MB each) — family names
// must match the internal font family satori matches on. The download base
// lives in scripts/lib/fonts.ts (pinned to a noto-cjk release tag, shared
// with gen-assets).
const NOTO_VARIANTS = {
  ja: { region: 'Japanese', family: 'Noto Sans CJK JP', prefix: 'NotoSansCJKjp' },
  zh: { region: 'SimplifiedChinese', family: 'Noto Sans CJK SC', prefix: 'NotoSansCJKsc' },
} as const;

type Script = keyof typeof NOTO_VARIANTS;
interface Article {
  id: string;
  absPath: string;
  locale: string;
  title: string;
  hasImage: boolean;
  /** The frontmatter `image:` points at a cover of a different format. */
  staleImage: boolean;
  draft: boolean;
}

// --- per-locale brand names ------------------------------------------------------
//
// Every locale JSON carries its own `site.shortName` ("Glimmerwick Wiki" for
// en/de/es/fr/ja/nl/pt/ru, the Chinese name for zh/zh-hant). A cover must show
// the brand of the locale it belongs to — printing the Chinese wordmark on an
// English or German cover showed readers a brand they cannot read.

const LOCALE_BRAND: Record<string, string> = {};
{
  const dir = join(root, 'src/locales');
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.json')) continue;
    const locale = file.replace(/\.json$/, '');
    try {
      const json = JSON.parse(readFileSync(join(dir, file), 'utf8')) as {
        site?: { shortName?: string };
      };
      const name = json.site?.shortName?.trim();
      if (name) LOCALE_BRAND[locale] = name;
    } catch {
      // A malformed locale JSON is a config-layer bug the i18n gates catch;
      // the cover generator just falls back to the global shortName.
    }
  }
}

// --- CLI ---------------------------------------------------------------------

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const opt = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
/** Every value passed after a flag until the next flag: `--only a/b --only c/d`. */
const opts = (name: string): string[] => {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] !== `--${name}`) continue;
    const next = args[i + 1];
    if (next === undefined || next.startsWith('--')) break;
    out.push(next);
    i++;
  }
  return out;
};
const ALL = flag('all');
const FORCE = flag('force');
const OUT_DIR = opt('out') ? resolve(opt('out') as string) : COVERS_DIR;
const FONTS_DIR = opt('fonts-dir') ? resolve(opt('fonts-dir') as string) : undefined;
const WIRE_FRONTMATTER = OUT_DIR === COVERS_DIR;
/** Restrict the run to the given content ids ("en/characters/abigailia") —
 *  for previewing a few covers without touching the rest of the library. */
const ONLY = opts('only');

// --- content scanning ----------------------------------------------------------

function listMdxFiles(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, name.name);
    if (name.isDirectory()) listMdxFiles(p, acc);
    else if (name.name.endsWith('.mdx')) acc.push(p);
  }
  return acc;
}

/** Minimal frontmatter read — same split-on-'---' approach as refresh-audit. */
function fmValue(fm: string, key: string): string | undefined {
  const m = fm.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'));
  if (!m) return undefined;
  return m[1].trim().replace(/^['"]|['"]$/g, '');
}

function collectArticles(): Article[] {
  return listMdxFiles(CONTENT_DIR).map((absPath) => {
    const src = readFileSync(absPath, 'utf8');
    const fm = src.split('---')[1] ?? '';
    // Normalize win32 separators before splitting: path.relative yields
    // backslashes there, and locale/coverFilename both split on '/'.
    const rel = relative(CONTENT_DIR, absPath)
      .split('\\')
      .join('/')
      .replace(/\.mdx$/, '');
    const [locale] = rel.split('/');
    return {
      id: rel,
      absPath,
      locale,
      title: fmValue(fm, 'title') ?? rel,
      hasImage: /^image:/m.test(fm),
      // Points at a cover of another format (a leftover .png) — the article
      // must be re-rendered and re-pointed, not treated as "already covered".
      staleImage: isStaleCoverRef(src, coverFilename(rel)),
      draft: /^draft:\s*true/m.test(fm),
    };
  });
}

// --- fonts ---------------------------------------------------------------------

interface SatoriFont {
  name: string;
  data: Buffer;
  /** satori's weight type is a literal union (100–900). */
  weight: 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900;
  style: 'normal';
}

function readLatinFonts(): SatoriFont[] {
  return (
    [
      ['Lato-Regular.ttf', 400],
      ['Lato-Bold.ttf', 700],
    ] as const
  ).map(([file, weight]) => ({
    name: 'Lato',
    data: readFileSync(join(root, 'scripts/fonts', file)),
    weight,
    style: 'normal' as const,
  }));
}

/**
 * The full Noto OTF per (script, weight), kept in memory for the whole run.
 * Re-reading and re-downloading the 16MB file per cover was the dominant
 * cost of a full-library run.
 */
const notoOtfCache = new Map<string, Buffer>();

/** Download attempts per font before giving up. */
const FONT_DOWNLOAD_ATTEMPTS = 4;

async function downloadNotoOtf(url: string, file: string): Promise<Buffer> {
  let lastError = '';
  for (let attempt = 1; attempt <= FONT_DOWNLOAD_ATTEMPTS; attempt++) {
    try {
      // AbortSignal — without it a stalled connection hangs the script forever.
      const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
      if (!res.ok) {
        throw new Error(
          `${url} → HTTP ${res.status}. Offline? Pre-download ${file} into a dir and pass --fonts-dir <dir>.`,
        );
      }
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 1_000_000) {
        throw new Error(`${file} looks truncated (${buf.length} bytes) — not cached.`);
      }
      return buf;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      // A 16MB file over a flaky link is routinely reset mid-transfer; a
      // single failed attempt must not abort a run that has hundreds of
      // covers left to render.
      console.warn(`  ⚠ ${file} download attempt ${attempt} failed: ${lastError}`);
      if (attempt < FONT_DOWNLOAD_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, 3_000 * attempt));
      }
    }
  }
  throw new Error(`${file} could not be downloaded after ${FONT_DOWNLOAD_ATTEMPTS} attempts: ${lastError}`);
}

async function ensureNotoOtf(script: Script, weight: 'Regular' | 'Bold'): Promise<Buffer> {
  const v = NOTO_VARIANTS[script];
  const key = `${script}:${weight}`;
  const cached = notoOtfCache.get(key);
  if (cached) return cached;
  const file = `${v.prefix}-${weight}.otf`;
  const candidates = [FONTS_DIR, FONT_CACHE].filter(Boolean) as string[];
  for (const dir of candidates) {
    const p = join(dir, file);
    if (existsSync(p)) {
      const buf = readFileSync(p);
      notoOtfCache.set(key, buf);
      return buf;
    }
  }
  const url = `${NOTO_BASE}/${v.region}/${file}`;
  console.log(`  downloading ${file} (~16MB, cached for future runs) …`);
  const buf = await downloadNotoOtf(url, file);
  mkdirSync(FONT_CACHE, { recursive: true });
  writeFileSync(join(FONT_CACHE, file), buf);
  notoOtfCache.set(key, buf);
  return buf;
}

async function subsetNoto(script: Script, glyphs: string): Promise<SatoriFont[]> {
  const v = NOTO_VARIANTS[script];
  const full = {
    400: await ensureNotoOtf(script, 'Regular'),
    700: await ensureNotoOtf(script, 'Bold'),
  };
  return Promise.all(
    (
      [
        [400, full[400]],
        [700, full[700]],
      ] as const
    ).map(async ([weight, buffer]) => ({
      name: v.family,
      weight,
      style: 'normal' as const,
      data: await subsetFont(buffer, glyphs, { targetFormat: 'sfnt' }),
    })),
  );
}

// --- rendering -------------------------------------------------------------------

interface Element {
  type: string;
  props: {
    style?: Record<string, unknown>;
    children?: unknown;
    [key: string]: unknown;
  };
}

function el(type: string, style: Record<string, unknown>, children?: unknown, extra: Record<string, unknown> = {}): Element {
  return { type, props: { ...extra, style, ...(children !== undefined ? { children } : {}) } };
}

function coverElement(opts: {
  title: string;
  fontSize: number;
  brandHex: string;
  brandDeepHex: string;
  lang: string;
  fontFamily: string;
  brandName: string;
}): Element {
  const brandLine = coverBrandLine(opts.brandName);
  return el(
    'div',
    {
      width: '100%',
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'space-between',
      padding: '72px 72px 64px 96px',
      backgroundImage: `linear-gradient(135deg, #0f131c 0%, #151b28 55%, ${opts.brandDeepHex} 100%)`,
      position: 'relative',
      fontFamily: opts.fontFamily,
      backgroundColor: '#0f131c',
    },
    [
      // Brand accent bar — the only brand-colored surface on the cover.
      el('div', { position: 'absolute', left: 0, top: 0, bottom: 0, width: '14px', backgroundColor: opts.brandHex }),
      // Top row: wiki short name.
      el(
        'div',
        { display: 'flex', alignItems: 'center' },
        el(
          'div',
          {
            fontSize: '30px',
            fontWeight: 700,
            color: opts.brandHex,
            letterSpacing: '6px',
          },
          brandLine,
        ),
      ),
      // Title — sized by pickFontSize to stay within ~2 lines.
      el(
        'div',
        {
          display: 'flex',
          alignItems: 'center',
          flexGrow: 1,
          paddingTop: '24px',
          paddingBottom: '24px',
        },
        el('div', {
          fontSize: `${opts.fontSize}px`,
          fontWeight: 700,
          color: '#f1f5f9',
          lineHeight: 1.18,
          maxWidth: '1000px',
          textWrap: 'balance',
        }, opts.title),
      ),
      // Bottom row: game name · domain.
      el(
        'div',
        { display: 'flex', alignItems: 'center', gap: '18px' },
        [
          el('div', { width: '46px', height: '5px', backgroundColor: opts.brandHex, borderRadius: '3px' }),
          el(
            'div',
            { fontSize: '26px', color: '#8b95a8', letterSpacing: '1px' },
            `${site.game.name}  ·  ${coverDomain()}`,
          ),
        ],
      ),
    ],
    { lang: opts.lang },
  );
}

async function renderCover(article: Article, brandHex: string, brandDeepHex: string): Promise<Buffer> {
  const title = stripEmoji(article.title);
  if (title !== article.title) console.warn(`  ⚠ stripped emoji from "${article.title}"`);
  // The brand line is the locale's OWN site.shortName (en/de/es/… read
  // "Glimmerwick Wiki", zh/zh-hant read the Chinese name) — the global
  // site.shortName would put a Chinese wordmark on every language's cover.
  const brandName = coverBrandName(article.locale, LOCALE_BRAND, site.shortName);
  // The cover shows the brand line and the game name on EVERY article, so the
  // CJK font decision must span all three strings — deciding from the title
  // alone left a Han brand name rendered from Lato's .notdef (tofu).
  const script = coverFontScript(article.locale, [title, brandName, site.game.name]);
  const fonts: SatoriFont[] = readLatinFonts();
  let fontFamily = 'Lato';
  let lang = 'en';
  if (script) {
    // The brand line carries the no-break space, so the subset needs the
    // exact strings that get rendered — not the raw config values.
    const glyphs = subsetText(title, coverBrandLine(brandName), site.game.name);
    fonts.push(...(await subsetNoto(script, glyphs)));
    fontFamily = `Lato, ${NOTO_VARIANTS[script].family}`;
    lang = script === 'ja' ? 'ja-JP' : 'zh-CN';
  }
  const element = coverElement({
    title,
    fontSize: pickFontSize(title),
    brandHex,
    brandDeepHex,
    lang,
    fontFamily,
    brandName,
  });
  const svg = await satori(element as unknown as Parameters<typeof satori>[0], {
    width: W,
    height: H,
    fonts,
  });
  // resvg only rasterizes to PNG; sharp re-encodes to WebP. A cover is a flat
  // gradient plus text, so WebP is ~7 KB against ~160 KB for PNG — the whole
  // library of covers then fits in git (and in the Pages file budget).
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: W } }).render().asPng();
  return sharp(png).webp({ quality: 82, effort: 4 }).toBuffer();
}

// --- frontmatter wiring ------------------------------------------------------------

function wireFrontmatter(mdxPath: string, imageRelPath: string, replace: boolean): boolean {
  const src = readFileSync(mdxPath, 'utf8');
  const updated = replace
    ? replaceImageInFrontmatter(src, imageRelPath)
    : spliceImageIntoFrontmatter(src, imageRelPath);
  if (updated === null) return false;
  // Atomic replace (same dir + rename): a crash mid-write must never leave a
  // truncated MDX behind — same contract as sync-codes.
  const tmpPath = `${mdxPath}.tmp`;
  writeFileSync(tmpPath, updated, 'utf8');
  renameSync(tmpPath, mdxPath);
  return true;
}

// --- main ---------------------------------------------------------------------------

async function main(): Promise<void> {
  if (!existsSync(CONTENT_DIR)) {
    console.error('No src/content/wiki — run from the repo root.');
    process.exit(1);
  }
  const css = readFileSync(join(root, 'src/styles/globals.css'), 'utf8');
  const brand = parseBrandHsl(css);
  if (!brand) {
    console.error('Could not parse --brand from src/styles/globals.css.');
    process.exit(1);
  }
  const brandHex = hslToHex(brand.h, brand.s, brand.l);
  const brandDeepHex = hslToHex(brand.h, brand.s, 20);

  const articles = collectArticles().filter((a) => !a.draft);
  const manifestPath = join(OUT_DIR, '.gen-covers-manifest.json');
  let manifest: { version: number; entries: Record<string, string> } = { version: MANIFEST_VERSION, entries: {} };
  if (existsSync(manifestPath)) {
    try {
      manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    } catch {
      console.warn('manifest unreadable — regenerating all covers.');
    }
  }

  mkdirSync(OUT_DIR, { recursive: true });
  let generated = 0;
  let skipped = 0;
  let wired = 0;
  let failed = 0;

  for (const article of articles) {
    if (ONLY.length > 0 && !ONLY.includes(article.id)) continue;
    const file = coverFilename(article.id);
    const ours = manifest.entries[file] !== undefined;
    // Custom --out is a preview run: render everything (frontmatter untouched).
    // A stale `image:` (wrong format) is always eligible — it must be
    // re-rendered and re-pointed, not skipped as "already covered".
    const eligible =
      !WIRE_FRONTMATTER || !article.hasImage || article.staleImage || (ALL && ours);
    if (!eligible) continue;

    const key = stableHash(
      `${article.title}|${coverBrandName(article.locale, LOCALE_BRAND, site.shortName)}|${site.game.name}|${coverDomain()}|${brandHex}|${W}x${H}|${COVER_FORMAT}|v${MANIFEST_VERSION}`,
    );
    if (!FORCE && manifest.entries[file] === key && existsSync(join(OUT_DIR, file))) {
      skipped++;
      continue;
    }

    console.log(`▸ ${file} — ${article.title}`);
    let image: Buffer;
    try {
      image = await renderCover(article, brandHex, brandDeepHex);
    } catch (err) {
      // One unrenderable article must not abandon the other hundreds — the
      // failure is reported and the run continues.
      failed++;
      console.error(
        `  ✗ ${file} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      continue;
    }
    writeFileSync(join(OUT_DIR, file), image);
    manifest.entries[file] = key;
    generated++;
    // Persist after every cover: a run interrupted halfway (Ctrl-C, a
    // network drop on the font download, a crash) used to lose the whole
    // manifest — and with it the knowledge that those covers already exist,
    // so the next run re-rendered everything from scratch.
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

    if (WIRE_FRONTMATTER && (!article.hasImage || article.staleImage)) {
      const absCover = join(COVERS_DIR, file);
      const relFromMdx = relative(dirname(article.absPath), absCover).split('\\').join('/');
      if (wireFrontmatter(article.absPath, relFromMdx, article.hasImage)) {
        wired++;
        console.log('  wired frontmatter image');
      }
    }
  }

  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  console.log(
    `\nDone: ${generated} generated, ${skipped} cached, ${wired} wired, ${failed} failed → ${relative(root, OUT_DIR)}`,
  );
  if (!WIRE_FRONTMATTER) console.log('(custom --out: frontmatter untouched)');
  // A partial run must not look like a success: the caller (CI, a human)
  // needs to know some covers are missing.
  if (failed > 0) process.exit(1);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
