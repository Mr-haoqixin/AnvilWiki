/**
 * cacheKey helpers for experimental.incrementalBuild (astro.config.ts).
 *
 * Astro skips re-rendering a getStaticPaths page only when BOTH its cacheKey
 * and its module-dependency-graph hash are unchanged. The module graph covers
 * code — layouts, components, and every locale JSON via ui.ts's static
 * imports, so any UI-string edit re-renders everything. What the graph CANNOT
 * see, and what these keys therefore fold in:
 *
 *   1. Content data: the served entry's `digest` (glob-loader content hash)
 *      plus the digests of every OTHER entry that can reach this page —
 *      related articles (tag-match / category / site-wide-newest tiers all
 *      draw from the whole served-locale pool), prev/next neighbours, and
 *      list/tag membership.
 *   2. Cross-locale hreflang coverage: alternates are built from OTHER
 *      locales' translations of the same article/category/tag
 *      (localesForEntry / localesForCategory / localesForTag).
 *   3. Env values baked into HTML (ads, GA, SITE_URL canonicals): env is
 *      invisible to both the entry digest and the module graph.
 *
 * Granularity trade-off, deliberately coarse: keys use a per-locale ROLLUP
 * digest, not per-page dependency tracking. Any edit anywhere in locale X
 * re-renders all of locale X's article/list/tag pages (~440 pages at ~36ms
 * per page) while the other nine locales stay cached. The coarseness buys
 * correctness: the coupling above is real (tier 3 of selectRelatedEntries
 * makes ANY new same-locale article a potential "Related" candidate), and a
 * missed edge ships a stale page — the exact self-contradictory-output class
 * this repo's gates exist to prevent. Equivalence between cached and forced
 * builds is audited by scripts/check-incremental.mjs (weekly CI workflow).
 *
 * Pure module: no astro:content / fs imports, vitest-loadable directly (same
 * contract as content-utils.ts). fnv1a is intentionally duplicated from
 * covers.ts (which has fs/css side effects at module scope) — the same
 * deliberate-duplication precedent as the three slugify implementations.
 */

import { parseEntryId } from '~/lib/content-utils';
import { slugifyTag } from '~/lib/url';

/** Minimal entry shape these helpers need — WikiEntry satisfies it. */
export interface CacheableEntry {
  id: string;
  /** Astro types the content-layer digest as string | number. */
  digest?: string | number;
  data: {
    /** Drafts never reach a page; routes pass published entries only. */
    draft?: boolean;
    noindex?: boolean;
    tags?: readonly string[];
  };
}

/** FNV-1a 32-bit, hex — stable across machines/processes for key equality. */
export function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * Fingerprint of every env value pages bake into HTML: SITE_URL (canonicals)
 * and all PUBLIC_* vars (ads, GA, Giscus, sponsor card). Other import.meta.env
 * keys (MODE/DEV/PROD) are excluded — they never differ between two builds
 * of the same commit in the same environment, so keying on them would only
 * waste cache hits.
 */
export function envFingerprint(env: Record<string, unknown>): string {
  const keys = Object.keys(env)
    .filter((k) => k === 'SITE_URL' || k.startsWith('PUBLIC_'))
    .sort();
  return fnv1a(keys.map((k) => `${k}=${String(env[k] ?? '')}`).join('\n'));
}

/**
 * Digest rollup of one locale's published entries (sorted by id — the rollup
 * must not depend on collection iteration order). Covers every same-locale
 * coupling in one hash: related pools, prev/next neighbours, list/tag
 * membership, newest-first ordering.
 */
export function localeRollup(locale: string, entries: readonly CacheableEntry[]): string {
  const parts = entries
    .filter((e) => !e.data.draft && e.id.replace(/\.mdx$/, '').startsWith(`${locale}/`))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((e) => `${e.id}:${e.digest ?? ''}`);
  return fnv1a(parts.join('|'));
}

/**
 * "category/slug" to sorted locale list of published, non-noindex MDXs — the
 * hreflang alternate set of a detail page. Mirrors localesForEntry() in
 * src/i18n/content.ts (async, astro:content-bound); update the two together.
 */
export function entryCoverageMap(entries: readonly CacheableEntry[]): Map<string, string> {
  const coverage = new Map<string, Set<string>>();
  for (const entry of entries) {
    if (entry.data.draft || entry.data.noindex) continue;
    const parsed = parseEntryId(entry.id);
    if (!parsed) continue;
    const key = `${parsed.category}/${parsed.slug}`;
    let locales = coverage.get(key);
    if (!locales) {
      locales = new Set<string>();
      coverage.set(key, locales);
    }
    locales.add(parsed.locale);
  }
  const out = new Map<string, string>();
  for (const [key, locales] of coverage) out.set(key, Array.from(locales).sort().join(','));
  return out;
}

/**
 * category to sorted locale list with at least one published MDX — the
 * hreflang alternate set of a category list page. Mirrors localesForCategory()
 * in src/i18n/content.ts; update together. noindex articles still count on
 * purpose: the list page itself is indexable (same rule as the sitemap side).
 */
export function categoryCoverageMap(entries: readonly CacheableEntry[]): Map<string, string> {
  const coverage = new Map<string, Set<string>>();
  for (const entry of entries) {
    if (entry.data.draft) continue;
    const parsed = parseEntryId(entry.id);
    if (!parsed) continue;
    let locales = coverage.get(parsed.category);
    if (!locales) {
      locales = new Set<string>();
      coverage.set(parsed.category, locales);
    }
    locales.add(parsed.locale);
  }
  const out = new Map<string, string>();
  for (const [category, locales] of coverage) out.set(category, Array.from(locales).sort().join(','));
  return out;
}

/**
 * tag slug to sorted locale list where at least one published article carries
 * the tag — the alternate set of a tag page. Mirrors localesForTag() in
 * src/i18n/content.ts; update together.
 */
export function tagCoverageMap(entries: readonly CacheableEntry[]): Map<string, string> {
  const coverage = new Map<string, Set<string>>();
  for (const entry of entries) {
    if (entry.data.draft) continue;
    const parsed = parseEntryId(entry.id);
    if (!parsed) continue;
    for (const tag of entry.data.tags ?? []) {
      const slug = slugifyTag(tag);
      // Blank tags slugify to '' — the routes skip those slugs too.
      if (!slug) continue;
      let locales = coverage.get(slug);
      if (!locales) {
        locales = new Set<string>();
        coverage.set(slug, locales);
      }
      locales.add(parsed.locale);
    }
  }
  const out = new Map<string, string>();
  for (const [slug, locales] of coverage) out.set(slug, Array.from(locales).sort().join(','));
  return out;
}

/** Fold key parts into one stable cacheKey string. */
export function combineKeys(...parts: Array<string | number | undefined>): string {
  return fnv1a(parts.map((p) => String(p ?? '')).join(' '));
}
