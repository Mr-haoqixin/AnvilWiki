/**
 * Site URL / host resolution — the single place that decides "which host is
 * this site on".
 *
 * AGENTS.md rule #9: the domain lives in the `SITE_URL` environment
 * variable, never hardcoded in source. `src/config/site.ts` still carries a
 * `domain` field (apply-template rewrites it, and it is the fallback when
 * no env is set), but the EFFECTIVE host is always:
 *
 *   SITE_URL (env, wins)  →  its host
 *   else                  →  the `domain` field
 *
 * Keeping the resolution here (pure, framework-free) means the site config,
 * the cover generator and the config gates all agree by construction — the
 * class of bug where the cover advertised one host while the canonical URL
 * pointed at another.
 */

/** Parse a host out of an absolute URL. Returns null when there is no host. */
export function hostFromUrl(raw: string | undefined | null): string | null {
  const value = (raw ?? '').trim();
  if (!value) return null;
  try {
    // A bare host ("example.com") is not a valid absolute URL — prefix it
    // so new URL() can parse it, then strip the placeholder scheme back off.
    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`;
    const host = new URL(withScheme).host;
    return host || null;
  } catch {
    return null;
  }
}

/**
 * The effective site host.
 *
 * @param envUrl  the SITE_URL value (env), when present
 * @param fallbackDomain  the `domain` field from site.ts
 */
export function resolveSiteHost(
  envUrl: string | undefined | null,
  fallbackDomain: string,
): string {
  return hostFromUrl(envUrl) ?? hostFromUrl(fallbackDomain) ?? fallbackDomain;
}

/**
 * The effective absolute site URL (no trailing slash).
 *
 * @param envUrl  the SITE_URL value (env), when present
 * @param fallbackDomain  the `domain` field from site.ts
 */
export function resolveSiteUrl(
  envUrl: string | undefined | null,
  fallbackDomain: string,
): string {
  const raw = (envUrl ?? '').trim() || `https://${fallbackDomain}`;
  return raw.replace(/\/+$/, '');
}

/**
 * The host as it should appear in a rendered cover / UI (no protocol, no
 * trailing slash).
 */
export function displayHost(
  envUrl: string | undefined | null,
  fallbackDomain: string,
): string {
  return resolveSiteHost(envUrl, fallbackDomain);
}
