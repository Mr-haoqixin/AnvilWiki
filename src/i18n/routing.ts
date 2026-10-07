/**
 * i18n routing — the single source of truth for supported locales.
 *
 * 👉 APPLY TEMPLATE: When adding/removing a language, sync THREE places:
 *   1. Here — locales array
 *   2. src/locales/<locale>.json — actual file must exist (can be `{}` to start)
 *   3. src/content/wiki/<locale>/ — directory must exist (can be empty)
 *
 * URL strategy (as-needed prefix):
 *   - Chinese (default) has NO prefix: /guides/example
 *   - Other locales ARE prefixed:     /en/guides/example
 *
 * This is configured in astro.config.ts via `i18n.routing.prefixDefaultLocale: false`.
 */

export const locales = ['zh', 'en'] as const;

export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = 'zh';

/** Human-readable label for each locale (used in language switcher). */
export const LOCALE_LABELS: Record<Locale, string> = {
  zh: '简体中文',
  en: 'English',
};

/**
 * Open Graph wants og:locale in language_TERRITORY form (en_US, ja_JP) —
 * a bare ISO 639-1 code is technically invalid. Keyed loosely (not by
 * Locale) so new-locale.ts / apply-template.ts rewrites of the locales
 * array can't leave a type error behind, and landing-only locales (zh)
 * can be mapped too. Unknown locales fall back to the raw code at the
 * call site.
 */
export const OG_LOCALE_MAP: Record<string, string> = {
  en: 'en_US',
  ja: 'ja_JP',
  zh: 'zh_CN',
};

/** Whether the given locale is the default (Chinese, no URL prefix). */
export function isDefaultLocale(locale: string): boolean {
  return locale === defaultLocale;
}

/** Type guard: narrow an arbitrary string to Locale. */
export function isLocale(value: string): value is Locale {
  return (locales as readonly string[]).includes(value);
}
