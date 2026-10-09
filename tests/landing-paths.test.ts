import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath: string) => readFileSync(join(root, relativePath), 'utf8');

describe('game-wiki-only public routes', () => {
  test('project landing, comparison, community, privacy, and handbook routes are absent', () => {
    const removedRoutes = [
      'src/pages/landing.astro',
      'src/pages/landing/community.astro',
      'src/pages/landing/comparison.astro',
      'src/pages/landing/docs/index.astro',
      'src/pages/landing/docs/learn.astro',
      'src/pages/landing/docs/dev.astro',
      'src/pages/landing/docs/[slug].astro',
      'src/pages/zh/landing.astro',
      'src/pages/zh/landing/community.astro',
      'src/pages/zh/landing/comparison.astro',
      'src/pages/zh/landing/privacy.astro',
      'src/pages/zh/landing/docs/index.astro',
      'src/pages/zh/landing/docs/learn.astro',
      'src/pages/zh/landing/docs/dev.astro',
      'src/pages/zh/landing/docs/[slug].astro',
    ];

    for (const route of removedRoutes) {
      expect(existsSync(join(root, route)), `${route} must not publish`).toBe(false);
    }
  });

  test('sitemap and llms.txt no longer advertise project pages', () => {
    expect(read('astro.config.ts')).not.toContain('/zh/landing');
    expect(read('src/pages/llms.txt.ts')).not.toContain('/landing');
  });

  test('handbook is not registered as a public content collection', () => {
    expect(read('src/content.config.ts')).not.toContain('handbook');
  });

  test('ads and project showcase assets are not shipped', () => {
    expect(read('src/components/layout/BaseLayout.astro')).not.toContain('adsenseClient');
    expect(read('src/components/layout/LocaleLayout.astro')).not.toContain('StickyBanner');
    expect(read('src/components/article/ArticlePage.astro')).not.toMatch(
      /AdsterraSlot|InContentAd|MobileAnchorAd|AdSenseSlot/,
    );
    expect(read('src/components/sidebar/WikiSidebar.astro')).not.toMatch(
      /AdsterraSlot|SidebarAd|AdSenseSlot/,
    );
    expect(read('wrangler.toml')).not.toMatch(/^\s*PUBLIC_AD(?:SENSE|STERRA)_.*=\s*["'][^"']+/m);
    for (const asset of [
      'public/ads/sticky-320x50.html',
      'public/ads/sidebar-300x250.html',
      'public/ads/sidebar-160x300.html',
      'public/ads/sidebar-160x600.html',
      'public/ads/native-banner.html',
      'public/ads/incontent-728x90.html',
      'public/images/showcase/sites/warhounds.jpg',
      'public/images/showcase/sites/steal-anegg.jpg',
      'public/images/showcase/sites/sephiria.jpg',
      'public/images/showcase/sites/sandustry.jpg',
      'public/images/showcase/sites/resonance.jpg',
      'public/images/showcase/sites/nomanssky.jpg',
      'public/images/showcase/sites/mortal-shell-ii.png',
      'public/images/showcase/sites/jjs-player-guide.png',
      'public/images/showcase/sites/aniimo.jpg',
      'public/images/showcase/demo-tier-list.webp',
      'public/images/showcase/demo-mobile.webp',
      'public/images/showcase/demo-home.webp',
      'public/images/showcase/demo-codes.webp',
      'public/images/showcase/demo-article.webp',
      'public/images/wechat-qr.jpg',
    ]) {
      expect(existsSync(join(root, asset)), `${asset} must not ship`).toBe(false);
    }
  });
});
