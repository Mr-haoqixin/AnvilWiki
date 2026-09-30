import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

/**
 * public/_redirects carries demo-layer exact-path 301s, in two rule classes:
 *
 * 1. Handbook lesson slugs removed by the handbook restructures (v1.14
 *    chapter split, v2.8.0-v2.12.0 teaching redesign).
 * 2. Locale entry points — the demo wiki ships en (no prefix) and ja; zh
 *    exists only as the project-site landing layer at /zh/landing/. Visitors
 *    guessing /zh or /en hit a hard 404 otherwise (reported 2026-09-28).
 *
 * These tests pin the file's contract:
 *   - exact-path rules only (placeholder rules looped with Cloudflare's
 *     directory normalization once before — never again);
 *   - every handbook source is a slug that REALLY no longer exists, so a
 *     rule can never shadow a live lesson (Cloudflare applies _redirects
 *     before static assets); every locale-entry source REALLY has no route;
 *   - every target REALLY exists (handbook: in the matching locale's
 *     handbook sources; locale entry: backed by a real page file);
 *   - en (no prefix) and /zh cover the same handbook slug set;
 *   - fork initialization removes the file on BOTH channels (CLI
 *     LANDING_PATHS + setup.yml landing step) — the file only serves
 *     /landing/docs and /zh/landing URLs, which forks do not have.
 */
const repoRoot = fileURLToPath(new URL('..', import.meta.url));

/** [old slug, successor lesson] — mirrors the redesign spec's mapping table. */
const REMOVED_SLUGS: Array<readonly [string, string]> = [
  ['deploy-and-get-indexed', 'put-site-online'],
  ['monetize-and-grow', 'enable-ads'],
  ['pick-your-game', 'find-candidates'],
  ['launch-your-site', 'run-your-site'],
  ['first-10-pages', 'first-article'],
  ['templatize-your-site', 'clone-your-site'],
  ['seo-traffic', 'rank-one-keyword'],
  ['sync-and-contribute', 'sync-upstream'],
  ['ci-and-security', 'verify-your-changes'],
];
const LOCALE_PREFIXES = ['', '/zh'] as const;

/** Locale-entry rules: [source, target] — targets are live demo routes. */
const LOCALE_ENTRY_RULES: Array<readonly [string, string]> = [
  ['/zh/', '/zh/landing/'],
  ['/zh', '/zh/landing/'],
  ['/en/', '/'],
  ['/en', '/'],
];

type Rule = { source: string; target: string; status: string };

const HANDBOOK_SOURCE_RE = /^\/(zh\/)?landing\/docs\/[\w-]+\/?$/;
const HANDBOOK_TARGET_RE = /^\/(zh\/)?landing\/docs\/[\w-]+\/$/;
const LOCALE_ENTRY_SOURCE_RE = /^\/(en|zh)\/?$/;
const LOCALE_ENTRY_TARGET_RE = /^\/$|^\/zh\/landing\/$/;

function parseRedirects(): Rule[] {
  const raw = readFileSync(`${repoRoot}public/_redirects`, 'utf8');
  const rules: Rule[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const parts = trimmed.split(/\s+/);
    expect(parts, `malformed _redirects line (want "src target 301"): ${line}`).toHaveLength(3);
    const [source, target, status] = parts;
    expect(
      HANDBOOK_SOURCE_RE.test(source) || LOCALE_ENTRY_SOURCE_RE.test(source),
      `unknown rule shape (handbook slug or locale entry only): ${line}`,
    ).toBe(true);
    const targetOk = HANDBOOK_TARGET_RE.test(target) || LOCALE_ENTRY_TARGET_RE.test(target);
    expect(targetOk, `target must be a handbook lesson or a locale-entry homepage: ${line}`).toBe(
      true,
    );
    expect(status, `permanent only, no placeholders: ${line}`).toBe('301');
    rules.push({ source, target, status });
  }
  return rules;
}

function isHandbookRule(rule: Rule): boolean {
  return rule.source.includes('/landing/docs/');
}

function handbookSlugs(locale: 'en' | 'zh'): Set<string> {
  const files = readdirSync(`${repoRoot}docs/handbook/${locale}`);
  return new Set(files.filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3)));
}

function localeOf(pathname: string): 'en' | 'zh' {
  return pathname.startsWith('/zh/') ? 'zh' : 'en';
}

function slugOf(pathname: string): string {
  const parts = pathname.replace(/\/$/, '').split('/');
  return parts[parts.length - 1];
}

describe('public/_redirects (renamed handbook lesson slugs)', () => {
  const rules = parseRedirects();
  const handbookRules = rules.filter(isHandbookRule);

  test('covers exactly the removed slugs × both locales × both slash forms — nothing more', () => {
    const expected = new Set(
      LOCALE_PREFIXES.flatMap((prefix) =>
        REMOVED_SLUGS.flatMap(([from]) => [
          `${prefix}/landing/docs/${from}/`,
          `${prefix}/landing/docs/${from}`,
        ]),
      ),
    );
    const sources = handbookRules.map((r) => r.source);
    expect(new Set(sources).size, 'duplicate source paths').toBe(sources.length);
    expect(new Set(sources)).toEqual(expected);
  });

  test('en and /zh map the same slugs to the same lessons', () => {
    const byLocale = new Map<string, Set<string>>();
    for (const rule of handbookRules) {
      const key = `${localeOf(rule.source)}:${slugOf(rule.source)}`;
      const pair = `${localeOf(rule.target)}:${slugOf(rule.target)}`;
      expect(localeOf(rule.target), `cross-locale redirect: ${rule.source}`).toBe(
        localeOf(rule.source),
      );
      byLocale.set(key, (byLocale.get(key) ?? new Set()).add(pair));
    }
    for (const [, pairs] of byLocale) expect(pairs.size).toBe(1);
  });

  test('no source slug is a live lesson — redirects must never shadow real pages', () => {
    for (const rule of handbookRules) {
      const slugs = handbookSlugs(localeOf(rule.source));
      expect(
        slugs.has(slugOf(rule.source)),
        `${rule.source} exists in docs/handbook — the 301 would hide a live lesson`,
      ).toBe(false);
    }
  });

  test('every target is a live lesson in the same locale — no redirect into a 404', () => {
    for (const rule of handbookRules) {
      const slugs = handbookSlugs(localeOf(rule.target));
      expect(slugs.has(slugOf(rule.target)), `${rule.target} is not a handbook lesson`).toBe(true);
    }
  });

  test('no chains — a target must never be the source of another rule', () => {
    const sources = new Set(rules.map((r) => r.source));
    for (const rule of rules) {
      expect(sources.has(rule.target), `${rule.target} is itself redirected`).toBe(false);
    }
  });
});

describe('public/_redirects (locale entry points)', () => {
  const rules = parseRedirects();
  const localeEntryRules = rules.filter((r) => LOCALE_ENTRY_SOURCE_RE.test(r.source));

  test('covers exactly the guessed locale paths × both slash forms — nothing more', () => {
    const expected = new Set(LOCALE_ENTRY_RULES.map(([source]) => source));
    const sources = localeEntryRules.map((r) => r.source);
    expect(new Set(sources).size, 'duplicate source paths').toBe(sources.length);
    expect(new Set(sources)).toEqual(expected);
  });

  test('every target matches its locale entry and is a live demo route', () => {
    const bySource = new Map(localeEntryRules.map((r) => [r.source, r.target]));
    for (const [source, target] of LOCALE_ENTRY_RULES) {
      expect(bySource.get(source), `${source} must target ${target}`).toBe(target);
    }
    // /zh/landing/ is produced by src/pages/zh/landing.astro; / by src/pages/index.astro.
    expect(existsSync(`${repoRoot}src/pages/zh/landing.astro`), '/zh/landing/ route file').toBe(
      true,
    );
    expect(existsSync(`${repoRoot}src/pages/index.astro`), '/ route file').toBe(true);
  });

  test('no source has a live route — redirects must never shadow real pages', () => {
    // If any of these ever becomes a real page, the 301 would hide it
    // (Cloudflare applies _redirects before static assets) — fail loudly.
    expect(existsSync(`${repoRoot}src/pages/zh/index.astro`), 'src/pages/zh/index.astro').toBe(
      false,
    );
    expect(existsSync(`${repoRoot}src/pages/zh/index/`), 'src/pages/zh/index/').toBe(false);
    expect(existsSync(`${repoRoot}src/pages/en.astro`), 'src/pages/en.astro').toBe(false);
    expect(existsSync(`${repoRoot}src/pages/en/`), 'src/pages/en/').toBe(false);
  });
});

test('fork initialization removes the file on both channels (CLI + setup.yml)', () => {
  const cli = readFileSync(`${repoRoot}scripts/apply-template.ts`, 'utf8');
  expect(cli).toMatch(/'public\/_redirects'/);
  const yml = readFileSync(`${repoRoot}.github/workflows/setup.yml`, 'utf8');
  const landingStep = yml.split('\n').find((line) => line.includes('rm -rf src/components/landing'));
  expect(landingStep, 'landing removal step in setup.yml').toBeDefined();
  expect(landingStep).toContain('public/_redirects');
  // It rides the unconditional landing step, not the demo-content step —
  // forks never serve /landing/docs regardless of clear_demo_content.
  const demoStep = yml.split('\n').find((line) => line.includes('scripts/clear-demo-public.ts'));
  expect(demoStep, 'content-aware demo public cleanup step').toBeDefined();
  expect(demoStep).not.toContain('public/_redirects');
});
