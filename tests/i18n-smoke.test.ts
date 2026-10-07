/**
 * i18n smoke test — regression guard for the "hardcoded locale" bug class.
 *
 * In v1.1.0 five getStaticPaths implementations inlined `['ja']` while the
 * CLI accepted any locale list — forks adding a 3rd language got site-wide
 * 404s. This test greps the route/i18n sources for hardcoded locale arrays
 * so the bug class can't silently return.
 *
 * The route sweep WALKS src/pages/[locale]/ instead of whitelisting files:
 * a brand-new locale route file joins the assertions automatically — new
 * files were exactly the ones that used to skip locale derivation.
 */
import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { getUi } from '~/i18n/ui';

const ROOT = path.resolve(__dirname, '..');
const LOCALE_ROUTES_DIR = path.join(ROOT, 'src/pages/[locale]');

function localeRouteFiles(): string[] {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.astro')) files.push(full);
    }
  };
  walk(LOCALE_ROUTES_DIR);
  return files.sort();
}

// The route files above, plus the locale-derivation helper module itself.
const SWEEP_FILES = [...localeRouteFiles(), path.join(ROOT, 'src/i18n/content.ts')];

describe('i18n: no hardcoded locale arrays', () => {
  it('the route walk actually finds the locale route files (no silent empty scan)', () => {
    // index + faq + [...slug] + [legal] + recent + tags/index + tags/[tag].
    expect(localeRouteFiles().length).toBeGreaterThanOrEqual(7);
  });

  for (const file of SWEEP_FILES) {
    const rel = path.relative(ROOT, file);
    it(`${rel} derives locales from routing.ts (no inline ['xx'] arrays)`, () => {
      const src = fs.readFileSync(file, 'utf8');
      // Matches ['ja'], ['en'], ['ja','zh'] etc. — but NOT `locales` identifiers.
      const hardcoded = src.match(/\[\s*['"][a-z]{2}['"]\s*(,\s*['"][a-z]{2}['"]\s*)*\]/g);
      expect(hardcoded ?? [], `found hardcoded locale array in ${rel}: ${hardcoded?.join(', ')}`).toHaveLength(0);
    });
  }

  it('routing.ts locales array is parseable and non-empty', () => {
    const src = fs.readFileSync(path.resolve(ROOT, 'src/i18n/routing.ts'), 'utf8');
    const m = src.match(/export const locales = \[([^\]]+)\] as const;/);
    expect(m).toBeTruthy();
    const list = Array.from(m![1].matchAll(/['"]([^'"]+)['"]/g)).map((x) => x[1]);
    expect(list.length).toBeGreaterThan(0);
    expect(list).toContain('en');
  });
});

describe('i18n: getUi results are deeply frozen (read-only by contract AND at runtime)', () => {
  // getUi caches merged objects and deepMerge shares nested references with
  // the en module table — one caller mutating its copy would silently poison
  // every other locale's view. ui.ts deep-freezes all results so mutation
  // throws (strict-mode modules) instead.
  it('every locale flavor is deeply frozen (zh, en, unknown-locale fallback)', () => {
    const zh = getUi('zh');
    const en = getUi('en');
    expect(Object.isFrozen(zh)).toBe(true);
    expect(Object.isFrozen(zh.home)).toBe(true);
    expect(Object.isFrozen(en)).toBe(true);
    expect(Object.isFrozen(en.home)).toBe(true);
    expect(Object.isFrozen(en.shared)).toBe(true);
    const unknown = getUi('zz');
    expect(Object.isFrozen(unknown)).toBe(true);
  });

  it('serves the default Chinese UI through the retained English URL prefix', () => {
    expect(getUi('en').site.name).toBe(getUi('zh').site.name);
    expect(getUi('en').home.hero.title).toBe(getUi('zh').home.hero.title);
  });

  it('mutating a cached locale result throws (no silent cross-locale poisoning)', () => {
    const zh = getUi('zh');
    const en = getUi('en');
    expect(() => {
      (zh as Record<string, unknown>).nav = 'poison';
    }).toThrow();
    expect(() => {
      (en as Record<string, unknown>).nav = 'poison';
    }).toThrow();
    // Nesting that came from the en table through the merge must be frozen too.
    expect(() => {
      (en.shared as Record<string, unknown>).wikiNavAria = 'poison';
    }).toThrow();
  });
});
