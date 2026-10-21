/**
 * Tests for the site URL / host resolution (src/lib/site-url.ts).
 *
 * The domain lives in the SITE_URL environment variable (AGENTS.md rule #9);
 * `src/config/site.ts` keeps a `domain` field only as the fallback. These
 * tests pin the precedence and the parsing edge cases — the class of bug
 * where a cover advertised one host while the canonical URL pointed at
 * another.
 */
import { describe, expect, test } from 'vitest';
import { displayHost, hostFromUrl, resolveSiteHost, resolveSiteUrl } from '~/lib/site-url';

describe('hostFromUrl', () => {
  test('parses the host out of an absolute URL', () => {
    expect(hostFromUrl('https://glimmerwickwiki-8rm.pages.dev')).toBe(
      'glimmerwickwiki-8rm.pages.dev',
    );
    expect(hostFromUrl('https://example.com/path?x=1#y')).toBe('example.com');
  });

  test('accepts a bare host (no protocol)', () => {
    expect(hostFromUrl('example.com')).toBe('example.com');
    expect(hostFromUrl('example.com/wiki')).toBe('example.com');
  });

  test('keeps the port', () => {
    expect(hostFromUrl('http://localhost:4321')).toBe('localhost:4321');
  });

  test('returns null for empty or unparseable input', () => {
    expect(hostFromUrl('')).toBeNull();
    expect(hostFromUrl('   ')).toBeNull();
    expect(hostFromUrl(undefined)).toBeNull();
    expect(hostFromUrl(null)).toBeNull();
  });
});

describe('resolveSiteHost', () => {
  test('SITE_URL wins over the fallback domain', () => {
    expect(resolveSiteHost('https://env.example.com', 'fallback.example.com')).toBe(
      'env.example.com',
    );
  });

  test('falls back to site.domain when no env is set', () => {
    expect(resolveSiteHost(undefined, 'fallback.example.com')).toBe('fallback.example.com');
    expect(resolveSiteHost('', 'fallback.example.com')).toBe('fallback.example.com');
  });

  test('a malformed SITE_URL falls back instead of producing a broken host', () => {
    // "not a url" parses as a host by the bare-host rule, but a value with
    // spaces cannot be a host at all.
    expect(resolveSiteHost('https://', 'fallback.example.com')).toBe('fallback.example.com');
  });
});

describe('resolveSiteUrl', () => {
  test('keeps the full URL and strips the trailing slash', () => {
    expect(resolveSiteUrl('https://example.com/', 'fallback.example.com')).toBe(
      'https://example.com',
    );
  });

  test('builds an absolute URL from the fallback domain', () => {
    expect(resolveSiteUrl(undefined, 'fallback.example.com')).toBe('https://fallback.example.com');
  });
});

describe('displayHost', () => {
  test('is the host without protocol or trailing slash', () => {
    expect(displayHost('https://example.com/', 'fallback.example.com')).toBe('example.com');
  });
});
