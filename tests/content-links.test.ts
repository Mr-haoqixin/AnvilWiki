/**
 * content-links contract tests — the shared Markdown link extraction
 * (scripts/lib/link-scan.ts), the asset-extension allowlist
 * (scripts/lib/asset-extensions.ts), and the cross-script alignment the
 * consuming check scripts must keep.
 *
 * Three layers:
 *   - unit: extractPageLinks on the image-wrapped-link shapes the old
 *     `(?<!!)` regex got wrong, and isAssetPath on the union the two old
 *     local lists drifted around;
 *   - behavioral: check-content.ts is spawned against a fixture repo to pin
 *     that an image WRAPPED in a link is visible to the trailing-slash
 *     (rule 4) and locale-prefix (rule 5) rules, and that asset hrefs no
 *     longer count toward the ≥3-internal-links rule (rule 6);
 *   - source contracts: the domain regex, the draft-detection idiom and the
 *     bounded nav-key regex stay identical across the scripts that parse the
 *     same fields (drift between them is what these findings were).
 */
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { isAssetPath } from '../scripts/lib/asset-extensions';
import { extractPageLinks } from '../scripts/lib/link-scan';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const TSX_CLI = join(repoRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');

const readRepo = (rel: string) => fs.readFileSync(join(repoRoot, rel), 'utf8');

// ---------------------------------------------------------------------------
// extractPageLinks — image syntax must never masquerade as a page link
// ---------------------------------------------------------------------------

describe('extractPageLinks', () => {
  test('image WRAPPED in a link yields the page link, not the asset (the M3 bug)', () => {
    expect(extractPageLinks('[![img](/images/a.webp)](/bosses/x/)')).toEqual(['/bosses/x/']);
  });

  test('plain image yields nothing', () => {
    expect(extractPageLinks('![alt](/images/a.png)')).toEqual([]);
  });

  test('plain link and mixed image+link lines', () => {
    expect(extractPageLinks('[text](/bosses/x/)')).toEqual(['/bosses/x/']);
    expect(extractPageLinks('![a](/i.png) and [t](/b/)')).toEqual(['/b/']);
  });

  test('image inside the link text', () => {
    expect(extractPageLinks('[see ![p](/i.png) here](/b/)')).toEqual(['/b/']);
  });

  test('titled form keeps the URL only', () => {
    expect(extractPageLinks('[t](/a/ "Title")')).toEqual(['/a/']);
  });

  test('anchors and queries stay attached (callers strip)', () => {
    expect(extractPageLinks('[a](/x/#h) [b](/y/?v=1)')).toEqual(['/x/#h', '/y/?v=1']);
  });

  test('external links pass through (callers filter non-"/" hrefs)', () => {
    expect(extractPageLinks('[g](https://example.com/a/)')).toEqual(['https://example.com/a/']);
  });

  test('order follows the line, duplicates kept', () => {
    expect(extractPageLinks('[a](/x/) [b](/y/) [c](/x/)')).toEqual(['/x/', '/y/', '/x/']);
  });
});

// ---------------------------------------------------------------------------
// isAssetPath — the adjudicated union of the two old local lists
// ---------------------------------------------------------------------------

describe('isAssetPath', () => {
  test('the drift case: mp4 was exempt in check-content but audited as a page by check-links', () => {
    expect(isAssetPath('/media/clip.mp4')).toBe(true);
  });

  test('extensions that lived in only one old list are now shared', () => {
    expect(isAssetPath('/s/x.mjs')).toBe(true);
    expect(isAssetPath('/x.webmanifest')).toBe(true);
  });

  test('adjudicated-in direct-link targets', () => {
    expect(isAssetPath('/docs/rules.pdf')).toBe(true);
    expect(isAssetPath('/files/pack.zip')).toBe(true);
    expect(isAssetPath('/media/clip.webm')).toBe(true);
  });

  test('the rest of the union', () => {
    for (const p of ['/a.png', '/a.jpg', '/a.jpeg', '/a.gif', '/a.webp', '/a.avif', '/a.svg', '/a.ico', '/a.json', '/a.xml', '/a.txt', '/a.css', '/a.js', '/a.woff', '/a.woff2']) {
      expect(isAssetPath(p)).toBe(true);
    }
  });

  test('case-insensitive', () => {
    expect(isAssetPath('/images/A.PNG')).toBe(true);
  });

  test('pages are never assets', () => {
    expect(isAssetPath('/bosses/a')).toBe(false);
    expect(isAssetPath('/bosses/a/')).toBe(false);
    expect(isAssetPath('/x.html')).toBe(false);
    expect(isAssetPath('/x.mdx')).toBe(false);
    expect(isAssetPath('')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// behavioral — check-content.ts against a fixture repo
// ---------------------------------------------------------------------------

/** Minimal fixture repo: routing.ts (the only file check-content reads
 *  outside src/content) plus the MDX bodies under test. */
function makeFixture(files: Record<string, string>): string {
  const root = fs.mkdtempSync(join(tmpdir(), 'anvil-content-links-'));
  fs.mkdirSync(join(root, 'src', 'i18n'), { recursive: true });
  fs.writeFileSync(
    join(root, 'src', 'i18n', 'routing.ts'),
    "export const locales = ['en', 'ja'] as const;\nexport const defaultLocale = 'en';\n",
    'utf8',
  );
  for (const [rel, body] of Object.entries(files)) {
    const p = join(root, 'src', 'content', 'wiki', rel);
    fs.mkdirSync(dirname(p), { recursive: true });
    fs.writeFileSync(p, body, 'utf8');
  }
  return root;
}

function runCheckContent(root: string): { status: number; stdout: string } {
  try {
    const stdout = execFileSync(process.execPath, [TSX_CLI, join(repoRoot, 'scripts', 'check-content.ts')], {
      cwd: root,
      encoding: 'utf8',
    });
    return { status: 0, stdout };
  } catch (e) {
    const err = e as { status?: number; stdout?: string };
    return { status: err.status ?? -1, stdout: err.stdout ?? '' };
  }
}

const FM = '---\ntitle: T\n---\n\n';

describe('check-content — image-wrapped links and asset counting (behavioral)', () => {
  const root = makeFixture({
    // Rule 4: the wrapped page link lacks the trailing slash. The asset URL
    // inside has none either — the report must name the PAGE link only.
    'en/bosses/wrapped.mdx': `${FM}[![cover](/images/a.webp)](/bosses/a)\n`,
    // Rule 5: a ja body whose wrapped page link is bare (silently lands on
    // the en page). The old regex let this pass silently.
    'ja/bosses/wrapped.mdx': `${FM}[![cover](/images/a.webp)](/bosses/a/)\n`,
    // Rule 6: exactly 2 real page links; the two asset text-links must not
    // pad the count (old behavior counted 4 → no warning).
    'en/guides/count.mdx':
      `${FM}See [one](/guides/a/) and [two](/guides/b/) plus [sheet](/images/sheet.png) and [clip](/media/clip.mp4).\n`,
  });
  const run = runCheckContent(root);

  test('rule 4 sees the wrapped page link (and only it)', () => {
    expect(run.status).toBe(1);
    expect(run.stdout).toContain('must end with "/" (trailingSlash always): /bosses/a');
    expect(run.stdout).not.toContain('/images/a.webp');
  });

  test('rule 5 sees the wrapped bare link in a non-default locale', () => {
    expect(run.stdout).toContain('without the "ja/" prefix');
  });

  test('asset hrefs are excluded from the ≥3-internal-links count', () => {
    expect(run.stdout).toContain('only 2 internal link(s) in body');
  });
});

// ---------------------------------------------------------------------------
// source contracts — same field, same parser, everywhere
// ---------------------------------------------------------------------------

describe('cross-script alignment contracts', () => {
  test('site.ts domain parsed with BOTH quote styles in check-config and template-audit', () => {
    for (const f of ['scripts/check-config.ts', 'scripts/template-audit.ts']) {
      expect(readRepo(f)).toContain("domain:\\s*['\"]([^'\"]+)['\"]");
    }
  });

  test('draft detection is frontmatter-only with the shared regex in all three scripts', () => {
    for (const f of ['scripts/check-i18n.ts', 'scripts/refresh-audit.ts', 'scripts/template-audit.ts']) {
      const src = readRepo(f);
      expect(src).toContain("split('---')[1]");
      expect(src).toContain('/^draft:\\s*true\\s*$/m');
    }
  });

  test('nav-key regex is left-bounded in check-config and template-audit', () => {
    for (const f of ['scripts/check-config.ts', 'scripts/template-audit.ts']) {
      expect(readRepo(f)).toContain(
        "(?<=[{,\\s])(?<!\\/\\/\\s*)key:\\s*['\"]([^'\"]+)['\"]",
      );
    }
  });

  test('asset-extension allowlist is single-sourced (no local copies left behind)', () => {
    const content = readRepo('scripts/check-content.ts');
    const links = readRepo('scripts/check-links.ts');
    expect(content).toContain("from './lib/asset-extensions'");
    expect(links).toContain("from './lib/asset-extensions'");
    // Tokens that only existed in the old local copies must be gone.
    expect(content).not.toContain('mp4');
    expect(links).not.toContain('webmanifest');
  });

  test('check-content extracts links via lib/link-scan (old inline regex gone)', () => {
    const content = readRepo('scripts/check-content.ts');
    expect(content).toContain("from './lib/link-scan'");
    expect(content).toContain('extractPageLinks(line)');
    expect(content).not.toContain('(?<!!)');
  });
});

describe('bilingual item catalog links and coverage', () => {
  const catalogSlugs = fs
    .readdirSync(join(repoRoot, 'src', 'content', 'wiki', 'en', 'items'))
    .filter((name) => name.startsWith('items-') && name !== 'items-directory.mdx')
    .sort();

  const rowCount = (content: string) => {
    const lines = content.split(/\r?\n/);
    const separatorIndex = lines.findIndex((line) => /^\|\s*-{3,}/.test(line));
    if (separatorIndex < 0) throw new Error('Item catalog table separator was not found.');
    let rows = 0;
    for (let index = separatorIndex + 1; index < lines.length && lines[index].startsWith('|'); index += 1) {
      rows += 1;
    }
    return rows;
  };

  test('the 14 English and Chinese category tables stay aligned at 552 entries', () => {
    expect(catalogSlugs).toHaveLength(14);
    const totals = new Map<string, number>();

    for (const locale of ['en', 'zh']) {
      let total = 0;
      for (const slug of catalogSlugs) {
        const content = readRepo(`src/content/wiki/${locale}/items/${slug}`);
        const rows = rowCount(content);
        expect(rows).toBeGreaterThan(0);
        if (locale === 'zh') {
          expect(rows).toBe(rowCount(readRepo(`src/content/wiki/en/items/${slug}`)));
        }
        total += rows;
      }
      totals.set(locale, total);
    }

    expect(totals.get('en')).toBe(552);
    expect(totals.get('zh')).toBe(552);
  });

  test('Flour catalog entries link to the localized detail page', () => {
    expect(readRepo('src/content/wiki/en/items/items-ingredients.mdx'))
      .toContain('[Flour](/items/flour/)');
    expect(readRepo('src/content/wiki/zh/items/items-ingredients.mdx'))
      .toContain('[面粉](/zh/items/flour/)');
  });
});
