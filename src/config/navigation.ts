/**
 * Navigation configuration — the single source of truth for content categories.
 *
 * 👉 APPLY TEMPLATE: Change this array when a new game has different content categories.
 *
 * The `key` MUST be identical in THREE places (rule enforced across the codebase):
 *   1. Here — NAVIGATION_CONFIG[].key
 *   2. src/locales/<locale>.json — nav.<key> (display label) + overview.<key> (list page meta)
 *   3. src/content/wiki/<locale>/<key>/ — MDX directory name
 *
 * Changing this one file automatically affects: nav menu, URL routes, sitemap,
 * content loading, and the sidebar.
 */

// Icons are referenced by string name; astro-icon resolves them from src/icons/.
// We avoid importing the icon component here so this file stays framework-agnostic
// and can be read by non-Astro tooling (scripts, tests).
export interface NavigationItem {
  /** Category slug. Must match `src/content/wiki/<locale>/<key>/` directory name. */
  key: string;
  /** URL path segment. Must be `/${key}`. */
  path: string;
  /** Icon name from src/icons/ (without extension). */
  icon: string;
  /** Whether this category has MDX content (always true for content types). */
  isContentType: true;
}

/** Menu order = array order — every consumer renders by physical position. */
export const NAVIGATION_CONFIG: NavigationItem[] = [
  { key: 'guides', path: '/guides', icon: 'lucide:book-open', isContentType: true },
  { key: 'glossary', path: '/glossary', icon: 'lucide:book-marked', isContentType: true },
  { key: 'characters', path: '/characters', icon: 'lucide:users', isContentType: true },
  { key: 'locations', path: '/locations', icon: 'lucide:map-pin', isContentType: true },
  { key: 'items', path: '/items', icon: 'lucide:package', isContentType: true },
  { key: 'updates', path: '/updates', icon: 'lucide:history', isContentType: true },
];

/** Derived list of content type slugs for the current game wiki. */
export const CONTENT_TYPES: string[] = NAVIGATION_CONFIG.map((n) => n.key);
