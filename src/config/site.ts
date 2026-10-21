/**
 * Site configuration — the single source of truth for game-specific metadata.
 *
 * 👉 APPLY TEMPLATE: Change every field here when building a new game wiki.
 * This is part of the CONFIG LAYER — framework code reads from here, never the reverse.
 *
 * The DOMAIN is the exception to "everything lives in this file": AGENTS.md
 * rule #9 puts it in the `SITE_URL` environment variable. The `domain` field
 * below is the FALLBACK for when no env is set (and the field apply-template
 * rewrites); the effective host is always resolved by `siteUrl` / `siteHost`
 * at the bottom of this file. Never read `site.domain` directly — use
 * `siteHost` / `siteUrl` so both agree with the deployed environment.
 */
import { resolveSiteHost, resolveSiteUrl } from '~/lib/site-url';

export interface SiteConfig {
  /** Full site name, used in <title> suffix and Organization JSON-LD. */
  name: string;
  /** Short name for PWA manifest, mobile logo, and the long-title <title> suffix (>50 chars). */
  shortName: string;
  /** Site description for Organization JSON-LD and og:site_name. */
  description: string;
  /** Domain without protocol or trailing slash. */
  domain: string;
  /** Hero tagline shown under the site title. */
  tagline: string;
  /** Copyright / legal disclaimer line shown in footer. */
  legalNotice: string;
  /**
   * Optional public contact email — rendered as a mailto link on the contact
   * page when set. AdSense reviewers look for a reachable contact channel;
   * if you run no social channels, set this.
   */
  contactEmail?: string;
  social: {
    /** Official game website URL (the game itself, not the wiki). */
    official: string;
    discord?: string;
    youtube?: string;
    twitter?: string;
    reddit?: string;
  };
  /**
   * Canonical URLs about the GAME (Steam page, official site, Wikipedia entry…).
   * Emitted as Organization JSON-LD `sameAs` — helps Google / AI engines link
   * this wiki to the game's knowledge-graph entity.
   */
  sameAs?: string[];
  game: {
    /** Full game name. */
    name: string;
    /** Platform: "Roblox" | "Steam" | "Epic Games" | "Mobile" | ... */
    platform: string;
    /** Developer / studio name. */
    developer: string;
    /** Genre description. */
    genre: string;
    /** ISO release date (optional). */
    releaseDate?: string;
  };
  /**
   * Dimensions of the default OG/Twitter share image (public/images/hero.webp).
   * Emitted as og:image:width / og:image:height so social crawlers can render
   * the share card without downloading the image first.
   */
  ogImageWidth: number;
  ogImageHeight: number;
  /** Default author name for articles without an explicit `author` in frontmatter (E-E-A-T signal). */
  defaultAuthor?: string;
}

export const site: SiteConfig = {
  name: '格林默威克之歌（Songs of Glimmerwick）中文 Wiki',
  shortName: '格林默威克 Wiki',
  description:
    '《格林默威克之歌》（Songs of Glimmerwick）中文攻略与资料站，整理魔法歌曲、校园生活、园艺、任务、道具及版本更新信息，并标注来源与核对日期。',
  /**
   * Fallback domain (host without protocol or trailing slash) — used only
   * when SITE_URL is not set. SITE_URL always wins (AGENTS.md rule #9).
   */
  domain: 'glimmerwickwiki-8rm.pages.dev',
  tagline: '格林默威克之歌中文攻略与玩家资料',
  legalNotice:
    '本站为非官方玩家资料站，与 Eastshade Studios 无隶属、赞助或背书关系。游戏名称、专有名词及原图版权归其各自权利人所有。',
  // 👉 APPLY TEMPLATE: set a real address if you run no social channels —
  // the contact page renders it as a mailto link.
  contactEmail: '',
  social: {
    official: 'https://eastshade.com/songs-of-glimmerwick/',
  },
  // 👉 APPLY TEMPLATE: point these at the game's real canonical pages.
  sameAs: [
    'https://eastshade.com/songs-of-glimmerwick/',
    'https://store.steampowered.com/app/1706510/Songs_of_Glimmerwick/',
  ],
  game: {
    name: 'Songs of Glimmerwick',
    platform: 'PC (Steam)',
    developer: 'Eastshade Studios',
    genre: '剧情向奇幻 RPG',
    releaseDate: '2026-09-30',
  },
  // hero.webp is 1200×630 (the recommended OG share aspect ratio).
  ogImageWidth: 1200,
  ogImageHeight: 630,
};

/**
 * Absolute site URL (no trailing slash).
 *
 * SITE_URL (env) wins; `site.domain` is the fallback. Resolved through
 * `~/lib/site-url` so the site config, the cover generator and the config
 * gates all derive the host the same way.
 */
export const siteUrl: string = resolveSiteUrl(process.env.SITE_URL, site.domain);

/**
 * The effective host (no protocol, no trailing slash).
 *
 * Read THIS instead of `site.domain` — it follows SITE_URL when the
 * deployment sets one.
 */
export const siteHost: string = resolveSiteHost(process.env.SITE_URL, site.domain);
