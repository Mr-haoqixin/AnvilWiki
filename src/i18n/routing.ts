/**
 * i18n routing — the single source of truth for supported locales.
 *
 * 👉 APPLY TEMPLATE: When adding/removing a language, sync THREE places:
 *   1. Here — locales array
 *   2. src/locales/<locale>.json — actual file must exist (can be `{}` to start)
 *   3. src/content/wiki/<locale>/ — directory must exist (can be empty)
 *
 * URL strategy (as-needed prefix):
 *   - English (default) has NO prefix: /tasks/example
 *   - Other locales ARE prefixed:     /zh/tasks/example
 *
 * This is configured in astro.config.ts via `i18n.routing.prefixDefaultLocale: false`.
 */

// Steam ships 8 in-game languages (en/zh-hans/zh-hant/ja/fr/de/ru/pt-BR);
// es and nl were retired 2026-10-26 (no in-game counterpart) — their URLs
// 301 to the unprefixed default-locale pages via public/_redirects.
export const locales = ['en', 'zh', 'ja', 'fr', 'de', 'pt', 'zh-hant', 'ru'] as const;

export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = 'en';

/** Human-readable label for each locale (used in language switcher). */
export const LOCALE_LABELS: Record<Locale, string> = {
  en: 'English',
  zh: '简体中文',
  ja: '日本語',
  fr: 'Français',
  de: 'Deutsch',
  pt: 'Português',
  'zh-hant': '繁體中文',
  ru: 'Русский',
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
  zh: 'zh_CN',
  ja: 'ja_JP',
  fr: 'fr_FR',
  de: 'de_DE',
  pt: 'pt_BR',
  'zh-hant': 'zh_TW',
  ru: 'ru_RU',
};

/** Whether the given locale is the default (English, no URL prefix). */
export function isDefaultLocale(locale: string): boolean {
  return locale === defaultLocale;
}

/** Type guard: narrow an arbitrary string to Locale. */
export function isLocale(value: string): value is Locale {
  return (locales as readonly string[]).includes(value);
}
