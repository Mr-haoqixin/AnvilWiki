/**
 * build-cache cacheKey helpers — determinism and sensitivity contracts.
 *
 * A wrong cacheKey is silent by nature: the page either renders stale or
 * re-renders needlessly, and nothing in the build goes red. These tests pin
 * the two properties that keep experimental.incrementalBuild safe:
 *   - STABLE: unchanged inputs (in any order) → identical key, so healthy
 *     pages actually hit the cache;
 *   - SENSITIVE: every input class the module graph can't see (other
 *     entries' digests, hreflang coverage, env) changes the key, so a stale
 *     page can't survive behind an unchanged key.
 */
import { describe, expect, test } from 'vitest';
import {
  categoryCoverageMap,
  combineKeys,
  entryCoverageMap,
  envFingerprint,
  fnv1a,
  localeRollup,
  tagCoverageMap,
  type CacheableEntry,
} from '~/lib/build-cache';

const entry = (
  id: string,
  data: Partial<CacheableEntry['data']> = {},
  digest = `${id}-d1`,
): CacheableEntry => ({ id, digest, data: { tags: [], ...data } });

describe('fnv1a', () => {
  test('matches FNV-1a 32-bit reference vectors', () => {
    expect(fnv1a('')).toBe('811c9dc5');
    expect(fnv1a('a')).toBe('e40c292c');
    expect(fnv1a('foobar')).toBe('bf9cf968');
  });
});

describe('envFingerprint', () => {
  test('stable regardless of key insertion order, sensitive to PUBLIC_* and SITE_URL', () => {
    const a = envFingerprint({ SITE_URL: 'https://x.pages.dev', PUBLIC_GA_ID: 'G-1', MODE: 'production' });
    const b = envFingerprint({ PUBLIC_GA_ID: 'G-1', MODE: 'test', SITE_URL: 'https://x.pages.dev' });
    expect(a).toBe(b);
    // MODE/DEV never vary between builds of the same commit → excluded.
    expect(envFingerprint({ MODE: 'a' })).toBe(envFingerprint({ MODE: 'b' }));
  });

  test('a changed ad/analytics value changes the fingerprint (module graph cannot see env)', () => {
    const before = envFingerprint({ PUBLIC_ADSENSE_CLIENT: 'ca-pub-1' });
    const after = envFingerprint({ PUBLIC_ADSENSE_CLIENT: 'ca-pub-2' });
    expect(before).not.toBe(after);
    expect(envFingerprint({ SITE_URL: 'https://a.dev' })).not.toBe(envFingerprint({ SITE_URL: 'https://b.dev' }));
  });
});

describe('localeRollup', () => {
  const corpus = [
    entry('en/tasks/a'),
    entry('en/tasks/b', {}, 'en/tasks/b-d1'),
    entry('zh/tasks/a', {}, 'zh-different-corpus'),
  ];

  test('only folds the target locale; other locales cannot change it', () => {
    const en = localeRollup('en', corpus);
    const zhOnly = [entry('zh/tasks/a', {}, 'zh-edited')];
    expect(localeRollup('en', [...corpus, ...zhOnly])).toBe(en);
  });

  test('a digest change in the locale changes the rollup (related/prev-next coupling)', () => {
    expect(localeRollup('en', corpus)).not.toBe(
      localeRollup('en', [entry('en/tasks/a'), entry('en/tasks/b', {}, 'CHANGED'), entry('zh/tasks/a')]),
    );
  });

  test('order-independent (sorted by id) and draft-free', () => {
    expect(localeRollup('en', corpus)).toBe(localeRollup('en', [...corpus].reverse()));
    const withDraft = [...corpus, entry('en/tasks/draft', { draft: true })];
    expect(localeRollup('en', withDraft)).toBe(localeRollup('en', corpus));
  });
});

describe('coverage maps mirror the canonical i18n helpers', () => {
  const corpus = [
    entry('en/tasks/a'),
    entry('zh/tasks/a'),
    entry('ja/tasks/a', { noindex: true }),
    entry('de/updates/x'),
  ];

  test('entryCoverageMap: noindex excluded (detail hreflang never advertises it)', () => {
    expect(entryCoverageMap(corpus).get('tasks/a')).toBe('en,zh');
  });

  test('categoryCoverageMap: noindex still counts (the list page is indexable)', () => {
    expect(categoryCoverageMap(corpus).get('tasks')).toBe('en,ja,zh');
  });

  test('tagCoverageMap: aggregates by slugified tag across locales', () => {
    const tagged = [
      entry('en/tasks/a', { tags: ['Beginner Guide'] }),
      entry('zh/tasks/a', { tags: ['Beginner Guide'] }),
      entry('ja/tasks/c', { tags: [] }),
    ];
    expect(tagCoverageMap(tagged).get('beginner-guide')).toBe('en,zh');
    expect(tagCoverageMap(tagged).has('')).toBe(false);
  });
});

describe('combineKeys', () => {
  test('composes parts deterministically; every part is load-bearing', () => {
    const base = combineKeys('article', 'ja', 'tasks/a', 'digest', 'rollup', 'coverage', 'env');
    expect(combineKeys('article', 'ja', 'tasks/a', 'digest', 'rollup', 'coverage', 'env')).toBe(base);
    expect(combineKeys('article', 'ja', 'tasks/a', 'OTHER', 'rollup', 'coverage', 'env')).not.toBe(base);
  });

  test('undefined parts collapse to empty strings, not "undefined"', () => {
    expect(combineKeys('x', undefined)).toBe(combineKeys('x', ''));
  });
});
