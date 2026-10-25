/**
 * check-content.ts
 *
 * Content lint — the rules that live in docs/content-format.md but were only
 * enforced by discipline. Pure fs scan over src/content/wiki/**\/*.mdx.
 *
 * Rules:
 *   1. No H1 in the body (`# ...`) — H1 is rendered from frontmatter title.
 *   2. Headings must not skip levels (H2 → H4 without an H3 in between).
 *   3. Images need alt text (`![alt](src)`, empty `![](src)` fails).
 *   4. Internal MD page links must end with "/" (site is trailingSlash:'always';
 *      Cloudflare serves /path/, a bare /path costs a 308 and misaligns
 *      canonical). Asset paths and anchors are exempt.
 *   5. Non-default-locale bodies: internal links MUST carry the locale prefix
 *      (`/ja/bosses/x`) — a bare `/bosses/x` silently lands on the English
 *      page (Aniimo shipped 177 such links before noticing).
 *   6. Fewer than 3 internal links in a body → warning (orphan-ish page:
 *      no internal links = no crawl paths, no PageRank flow).
 *   7. Frontmatter `category` must equal the path's directory segment —
 *      the URL is derived from the path while JSON-LD / prev-next derive
 *      from frontmatter, so a mismatch renders fine but ships structured
 *      data pointing at URLs that 404 (check-links can't see it: the page
 *      itself resolves).
 *   8. Frontmatter scalar hygiene: no UTF-8 BOM, no bare ' inside a
 *      single-quoted value (must be '' — js-yaml rejects the whole file
 *      otherwise), and `description` must parse to 40-165 chars (''
 *      escapes shorten the parsed value by one char per escape). All three
 *      shipped real build breaks from AI-written batches (2026-10-13/20
 *      cohorts) whose failures surfaced only at build time with cryptic
 *      messages — this rule catches them at the generation-stage self-check.
 *   9. No external image hotlinks in bodies (http(s) image sources must be
 *      cached under public/images/ and referenced by local path). Every
 *      hotlink is a chronic single point of failure held by a third party
 *      (seven refs were already 404 at source when localize-images.mjs ran
 *      on 2026-10-26) and check-links cannot see them.
 *
 * Style: warnings don't fail the build; errors exit 1 (can gate CI).
 *
 * Usage: pnpm check-content
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { isAssetPath } from './lib/asset-extensions';
import { extractPageLinks } from './lib/link-scan';
import { readDefaultLocale } from './lib/routing-flags';
import { walkFiles } from './lib/walk';

const ROOT = process.cwd();
const BASE = path.resolve(ROOT, 'src/content/wiki');

// Parsed from routing.ts (NOT hardcoded) so forks that change the default
// locale keep this rule honest.
const DEFAULT_LOCALE = readDefaultLocale(ROOT);

const files = walkFiles(BASE, { exts: ['.mdx'], skipDirs: ['temp', 'temp2'] });

let errorCount = 0;
const error = (file: string, line: number, msg: string) => {
  console.log(`   ❌ ${path.relative(ROOT, file)}:${line + 1}  ${msg}`);
  errorCount++;
};
const warn = (file: string, line: number, msg: string) => {
  console.log(`   ⚠️  ${path.relative(ROOT, file)}:${line + 1}  ${msg}`);
};

console.log(`\n📝 Content lint — ${files.length} MDX files\n`);

for (const file of files) {
  // Normalize CRLF → LF: on Windows with core.autocrlf the checked-out MDX
  // has \r\n line endings, and an exact `---` match would fail, making the
  // frontmatter look like body text (phantom H1s, shifted line numbers).
  const src = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  // Strip frontmatter (between the first two `---` lines).
  const lines = src.split('\n');
  const secondFm = lines.indexOf('---', 1);
  const bodyStart = secondFm === -1 ? 0 : secondFm + 1;
  const body = lines.slice(bodyStart);
  // Locale of this file (path shape: <locale>/<category>/<slug>.mdx) — rule 5
  // only applies to non-default locales.
  const fileLocale = path.relative(BASE, file).split(path.sep)[0];
  let internalLinkCount = 0;

  let prevLevel = 1; // H1 "level" from the frontmatter title.
  body.forEach((line, i) => {
    const ln = i + bodyStart;

    // 1. H1 in body.
    const h1 = line.match(/^#\s+/);
    if (h1) error(file, ln, 'H1 in body — the title H1 is rendered from frontmatter');

    // 2. Heading level skips.
    const h = line.match(/^(#{2,6})\s+/);
    if (h) {
      const level = h[1].length;
      if (level - prevLevel > 1) {
        warn(file, ln, `heading jumps H${prevLevel} → H${level}`);
      }
      prevLevel = level;
    }

    // 3. Images without alt text (MD image syntax) + 9. external image
    //    hotlinks (MD syntax AND raw <img> tags — localize first, see
    //    scripts/localize-images.mjs).
    const img = line.match(/!\[([^\]]*)\]\(([^)]+)\)/g) ?? [];
    for (const m of img) {
      const alt = m.match(/!\[([^\]]*)\]/)?.[1] ?? '';
      if (!alt.trim()) error(file, ln, `image without alt text: ${m.slice(0, 60)}`);
      const src = m.match(/\]\(([^)]+)\)/)?.[1] ?? '';
      if (/^https?:\/\//i.test(src)) {
        error(file, ln, `external image hotlink is forbidden (cache it under public/images/ first): ${src.slice(0, 60)}`);
      }
    }
    const imgTag = line.match(/<img\s[^>]*src="([^"]+)"/i);
    if (imgTag && /^https?:\/\//i.test(imgTag[1])) {
      error(file, ln, `external image hotlink is forbidden (cache it under public/images/ first): ${imgTag[1].slice(0, 60)}`);
    }

    // 4 + 5 + 6. Internal MD page links: trailing slash, locale prefix, and
    // link counting. Image syntax is stripped BEFORE extraction (lib/link-scan)
    // so an image WRAPPED in a link ([![img](a.webp)](/bosses/x/)) yields the
    // page link — the old inline negative-lookbehind regex anchored at the
    // outer `[` and captured the image's asset URL instead.
    for (const href of extractPageLinks(line)) {
      if (!href.startsWith('/') || href === '/') continue;
      // Strip #anchor / ?query before shape checks.
      const pathOnly = href.split('#')[0].split('?')[0];
      // Assets are locale-less by design (public/ is shared, shared
      // allowlist in lib/asset-extensions) — not page links: no shape
      // checks, no rule-6 credit.
      if (isAssetPath(pathOnly)) continue;
      internalLinkCount++;
      // 4. Page links end with "/".
      if (!pathOnly.endsWith('/')) {
        error(
          file,
          ln,
          `internal page link must end with "/" (trailingSlash always): ${href.slice(0, 60)}`,
        );
      }
      // 5. Non-default-locale bodies carry their own locale prefix.
      if (fileLocale !== DEFAULT_LOCALE) {
        const ok = href.startsWith(`/${fileLocale}/`) || href === `/${fileLocale}`;
        if (!ok) {
          error(
            file,
            ln,
            `non-default-locale body links without the "${fileLocale}/" prefix (silently lands on the ${DEFAULT_LOCALE} page): ${href.slice(0, 60)}`,
          );
        }
      }
    }
  });

  // 6. Fewer than 3 internal links → warning (zero internal links = orphan
  // page: no crawl paths, no PageRank flow — Aniimo shipped 54/56 like that).
  if (internalLinkCount < 3) {
    warn(file, bodyStart, `only ${internalLinkCount} internal link(s) in body — aim for ≥3`);
  }

  // 7. Frontmatter category must equal the directory segment. Nothing else
  // compares the two (Zod validates the value, check-config the directory):
  // an article in bosses/ declaring category: guides renders at /bosses/…
  // while JSON-LD and prev-next follow frontmatter — structured data that
  // points at URLs no sitemap knows.
  if (secondFm !== -1) {
    const catIdx = lines.slice(0, secondFm).findIndex((l) => /^category:/.test(l));
    if (catIdx !== -1) {
      const fmCategory = lines[catIdx].match(/^category:\s*['"]?([\w-]+)/)?.[1];
      const dirCategory = path.relative(BASE, file).split(path.sep)[1];
      if (fmCategory && dirCategory && fmCategory !== dirCategory) {
        error(
          file,
          catIdx,
          `frontmatter category "${fmCategory}" ≠ directory "${dirCategory}" — the URL follows the directory but JSON-LD/prev-next follow frontmatter`,
        );
      }
    }
  }

  // 8. Frontmatter scalar hygiene (see docblock). Runs even when secondFm is
  //    -1 for the BOM check — a BOM-headed file's frontmatter looks like body
  //    text to every ^--- anchored scan, which is exactly the failure.
  if (src.charCodeAt(0) === 0xfeff) {
    error(file, 0, 'file starts with a UTF-8 BOM — every ^--- anchored frontmatter scan (this lint, the build lastmod walk) misses the block');
  }
  if (secondFm !== -1) {
    const fmLines = lines.slice(1, secondFm);
    for (let i = 0; i < fmLines.length; i++) {
      const single = fmLines[i].match(/^([A-Za-z][\w-]*):\s*'(.*)'\s*$/);
      if (single && single[2].includes("'") && single[2].replace(/''/g, '').includes("'")) {
        error(
          file,
          i + 1,
          `"${single[1]}" has a bare ' inside a single-quoted YAML value — double it ('') or js-yaml rejects the whole file`,
        );
      }
    }
    const descIdx = fmLines.findIndex((l) => /^description:/.test(l));
    if (descIdx !== -1) {
      const rawDesc = fmLines[descIdx];
      const singleQ = rawDesc.match(/^description:\s*'(.*)'\s*$/);
      const doubleQ = rawDesc.match(/^description:\s*"(.*)"\s*$/);
      const parsedDesc = singleQ
        ? singleQ[1].replace(/''/g, "'")
        : doubleQ
          ? doubleQ[1].replace(/\\"/g, '"')
          : rawDesc.replace(/^description:\s*/, '');
      if (parsedDesc.length < 40 || parsedDesc.length > 165) {
        error(
          file,
          descIdx + 1,
          `description parses to ${parsedDesc.length} chars (schema requires 40-165${singleQ ? " — count AFTER '' → ' unescaping" : ''})`,
        );
      }
    }
  }
}

console.log(
  errorCount === 0
    ? `\n✅ Content lint clean.`
    : `\n❌ ${errorCount} content error${errorCount === 1 ? '' : 's'}.`,
);
process.exit(errorCount === 0 ? 0 : 1);
