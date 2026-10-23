/**
 * Project-level flags — describe the AnvilWiki open-source project itself,
 * NOT the demo game. This file survives `apply-template` (unlike the landing
 * page files, which the CLI removes).
 */

/**
 * Whether the project landing page (/landing, /zh/landing) exists.
 * When true, the demo site header shows a small hammer icon linking to it,
 * so demo visitors can discover the template behind the demo.
 *
 * `apply-template` flips this to false when it removes the landing page —
 * the header link disappears together with the pages.
 */
export const landingLinkEnabled = false;

/**
 * Where the demo header's template entry points, and its visible copy. The
 * bare hammer icon alone read as a game feature ("forge"), so desktop shows a
 * short label next to the icon on wide screens. Gated by `landingLinkEnabled`
 * (apply-template flips the flag when it removes the landing layer, so forks
 * never render this) — which is also why the copy lives here as a proper-noun
 * badge instead of locale JSON: it is template marketing, not wiki UI, and
 * must not linger as orphan keys in forked locales.
 */
export const landingLink = {
  href: '/landing/',
  label: 'Built with AnvilWiki',
  ariaLabel: 'About the AnvilWiki template',
} as const;

/**
 * Demo-only extra entry in the wiki language switcher: the marketing site has
 * a Chinese edition at /zh/landing/, but zh is NOT a wiki UI locale (routing
 * stays en+ja for content), so Chinese visitors landing on the wiki had zero
 * Chinese entry point (community feedback 2026-09-05 — two members hit it).
 * Gated by `landingLinkEnabled`: apply-template removes the landing layer and
 * flips the flag, so forks never render this.
 */
export const zhLandingLink = { label: '中文 · 官网', href: '/zh/landing/' } as const;

/**
 * Demo root gateway — the shadow page served at `/` by demo builds. In the
 * demo, `/` is the project storefront: it 301s to /zh/landing/ (the root rule
 * in public/_redirects is the live channel; this component is the in-dist
 * fallback for any asset-direct-serving scenario), and the English wiki home
 * moves to /demo/. Gated by `landingLinkEnabled` — apply-template flips the
 * flag when it removes the landing layer, so forks NEVER render it. This file
 * survives apply-template, so forks merely carry these as dead constants
 * (same contract as `landingLink` above).
 *
 * The `target` must stay byte-identical to the root rule's target in
 * public/_redirects — tests/redirects.test.ts pins both literals.
 *
 * Copy sync: title/description mirror the /zh/landing/ <head> (landing-zh.ts)
 * so the root share card matches the landing card — update both together.
 */
export const demoRootGateway = {
  target: '/zh/landing/',
  linkLabel: '进入 AnvilWiki 官网',
  title: 'AnvilWiki — 开源游戏 Wiki 模板 + AI 内容工作流',
  description:
    '开源游戏 wiki 模板 + AI 原生内容工作流:选对游戏、和 AI 对话就能产页、codes 页自动保鲜。Lighthouse 4×100、Cloudflare 免费部署、广告收入 100% 归你。',
} as const;
