import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  organizationJsonLd,
  websiteJsonLd,
  articleJsonLd,
  breadcrumbJsonLd,
  simpleBreadcrumbJsonLd,
  itemListJsonLd,
  faqPageJsonLd,
  pageTitle,
} from '~/lib/seo';
import { fallbackDetailPaths } from '~/lib/fallback-paths';
import { site } from '~/config/site';
import { authors } from '~/config/authors';

/** Repo-root-relative source text (contract-test helper, handbook.test.ts style). */
const src = (rel: string) => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8');

describe('SEO helpers', () => {
  describe('organizationJsonLd', () => {
    it('returns a valid Organization schema', () => {
      const json = organizationJsonLd();
      expect(json['@type']).toBe('Organization');
      expect(json['@context']).toBe('https://schema.org');
      expect(typeof json.name).toBe('string');
      expect(json.url).toMatch(/^https?:\/\//);
      expect(json.logo).toMatch(/\.png$/);
    });
  });

  describe('websiteJsonLd', () => {
    it('returns a valid WebSite schema with locale', () => {
      const json = websiteJsonLd('en');
      expect(json['@type']).toBe('WebSite');
      expect(json.inLanguage).toBe('en');
    });
  });

  describe('articleJsonLd', () => {
    it('includes all required Article fields', () => {
      const json = articleJsonLd({
        title: 'Test Article',
        description: 'A test article description.',
        datePublished: new Date('2026-01-01'),
        category: 'bosses',
        slug: 'test-slug',
        locale: 'en',
      });
      expect(json['@type']).toBe('Article');
      expect(json.headline).toBe('Test Article');
      expect(json.datePublished).toContain('2026-01-01');
      expect(json.image).toMatch(/^https?:\/\//);
      expect(json.mainEntityOfPage['@id']).toMatch(/\/bosses\/test-slug\/$/);
    });

    it('uses dateModified when provided, otherwise falls back to datePublished', () => {
      const published = new Date('2026-01-01');
      const modified = new Date('2026-06-01');
      const withModified = articleJsonLd({
        title: 'T',
 description: 'Desc that is long enough for validation here.',
        datePublished: published,
        dateModified: modified,
        category: 'bosses',
        slug: 's',
        locale: 'en',
      });
      expect(withModified.dateModified).toContain('2026-06-01');

      const noModified = articleJsonLd({
        title: 'T',
 description: 'Desc that is long enough for validation here.',
        datePublished: published,
        category: 'bosses',
        slug: 's',
        locale: 'en',
      });
      expect(noModified.dateModified).toContain('2026-01-01');
    });
  });

  describe('breadcrumbJsonLd', () => {
    it('produces a 3-level breadcrumb (Home → Category → Article)', () => {
      const json = breadcrumbJsonLd({
        category: 'bosses',
        categoryLabel: 'All Bosses',
        title: 'Emberfang Guide',
        slug: 'emberfang',
        locale: 'en',
      });
      expect(json['@type']).toBe('BreadcrumbList');
      expect(json.itemListElement).toHaveLength(3);
      expect(json.itemListElement[0].name).toBe('Home');
      expect(json.itemListElement[1].name).toBe('All Bosses');
      expect(json.itemListElement[2].name).toBe('Emberfang Guide');
    });

    // trailingSlash: 'always' — a slash-less Home item makes Google crawl the
    // bare URL first and eat a 308 on every breadcrumb.
    it('emits the Home item with a trailing slash for the default locale', () => {
      const json = breadcrumbJsonLd({
        category: 'bosses',
        categoryLabel: 'All Bosses',
        title: 'Emberfang Guide',
        slug: 'emberfang',
        locale: 'en',
      });
      expect(json.itemListElement[0].item).toMatch(/\/$/);
    });

    it('emits the localized Home item with a trailing slash for non-default locales', () => {
      const json = breadcrumbJsonLd({
        category: 'bosses',
        categoryLabel: 'ボス一覧',
        title: 'エンバーファング攻略',
        slug: 'emberfang',
        locale: 'en',
      });
      expect(json.itemListElement[0].item).toMatch(/\/en\/$/);
    });
  });

  describe('simpleBreadcrumbJsonLd', () => {
    it('emits the Home item with a trailing slash for every locale', () => {
      for (const locale of ['en', 'zh'] as const) {
        const json = simpleBreadcrumbJsonLd({
          pageLabel: 'All Bosses',
          path: '/bosses/',
          locale,
        });
        expect(json['@type']).toBe('BreadcrumbList');
        expect(json.itemListElement[0].item).toMatch(/\/$/);
      }
    });
  });

  describe('authors registry', () => {
    it('internal (non-http) profile URLs end with "/" (trailingSlash: always)', () => {
      for (const [name, info] of Object.entries(authors)) {
        if (!info.url || info.url.startsWith('http')) continue;
        expect(info.url, `author "${name}" url`).toMatch(/\/$/);
      }
    });
  });

  describe('itemListJsonLd', () => {
    it('numbers items starting from 1', () => {
      const json = itemListJsonLd({
        category: 'bosses',
        categoryLabel: 'All Bosses',
        locale: 'en',
        items: [
          { title: 'A', slug: 'a' },
          { title: 'B', slug: 'b' },
        ],
      });
      expect(json['@type']).toBe('ItemList');
      expect(json.itemListElement[0].position).toBe(1);
      expect(json.itemListElement[1].position).toBe(2);
    });
  });

  describe('faqPageJsonLd', () => {
    it('maps Q&A pairs to Question/Answer schema', () => {
      const json = faqPageJsonLd([
        { question: 'What is X?', answer: 'X is Y.' },
      ]);
      expect(json['@type']).toBe('FAQPage');
      expect(json.mainEntity[0]['@type']).toBe('Question');
      expect(json.mainEntity[0].acceptedAnswer.text).toBe('X is Y.');
    });
  });

  describe('pageTitle', () => {
    it('appends the site name with an em dash', () => {
      const t = pageTitle('Hello');
      expect(t).toContain('Hello');
      expect(t).toContain('—');
      expect(t.endsWith(site.name)).toBe(true);
    });

    it('skips the suffix when the title already carries the game name', () => {
      const t = pageTitle('Songs of Glimmerwick Guide');
      expect(t).toBe('Songs of Glimmerwick Guide');
    });

    it('switches to the short suffix for long titles (>50 chars)', () => {
      const long = 'Best Weapons and Armor for Early Game Players Ranked';
      const t = pageTitle(long);
      expect(t).toBe(`${long} — ${site.shortName}`);
    });
  });

  describe('fallbackDetailPaths', () => {
    const locales = ['zh', 'en'] as const;
    // Coverage shape mirrors astro.config's localeCoverage: "cat/slug" →
    // locales that really have a published MDX.
    const coverage = new Map<string, Set<string>>([
      // Chinese-only article → /en/ URL is a fallback page.
      ['bosses/stormcaller', new Set(['zh'])],
      // Translated in both locales → both URLs are real pages.
      ['bosses/emberfang', new Set(['en', 'zh'])],
      // English-only article is locale-owned and never creates a fallback.
      ['guides/en-only', new Set(['en'])],
      // Nested slug folds into the key after the category.
      ['guides/nested/deep-slug', new Set(['zh'])],
      // CJK slug keeps raw filesystem names (sitemap filter decodes first).
      ['items/熔炉之心', new Set(['zh'])],
    ]);

    it('derives one path per non-default locale missing a translation of a default-locale article', () => {
      expect(fallbackDetailPaths(coverage, locales, 'zh')).toEqual([
        '/en/bosses/stormcaller',
        '/en/guides/nested/deep-slug',
        '/en/items/熔炉之心',
      ]);
    });

    it('never emits paths for the default locale, translated slugs, or locale-owned articles', () => {
      const paths = fallbackDetailPaths(coverage, locales, 'zh');
      expect(paths).not.toContain('/zh/bosses/stormcaller');
      expect(paths).not.toContain('/en/bosses/emberfang');
      expect(paths).not.toContain('/en/guides/en-only');
      // With a single locale there is nothing to fall back to.
      expect(fallbackDetailPaths(coverage, ['en'], 'en')).toEqual([]);
    });

    it('is deterministic across calls (sorted keys, locales in order)', () => {
      const a = fallbackDetailPaths(coverage, locales, 'en');
      const b = fallbackDetailPaths(new Map(coverage), locales, 'en');
      expect(a).toEqual(b);
      expect(a).toEqual([...a].sort());
    });
  });

  describe('fallback noindex wiring (contract)', () => {
    it('uses the shared site URL for Astro canonical and sitemap origins', () => {
      const config = src('astro.config.ts');
      expect(config).toContain("import { siteUrl } from './src/config/site'");
      expect(config).toContain('const siteOrigin = siteUrl');
      expect(config).toContain('site: siteUrl');
      expect(config).not.toContain('https://anvil.wiki');
    });

    it('astro.config.ts derives sitemap exclusions from fallbackDetailPaths', () => {
      const config = src('astro.config.ts');
      expect(config).toContain("from './src/lib/fallback-paths'");
      expect(config).toContain('fallbackDetailPaths(coverage, locales, defaultLocale)');
    });

    it('ArticlePage passes isFallback into the noindex prop', () => {
      const page = src('src/components/article/ArticlePage.astro');
      expect(page).toContain('noindex={entry.data.noindex || isFallback}');
    });
  });
});
