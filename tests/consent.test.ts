/**
 * Consent-literal contract — CONSENT_STORAGE_KEY / CONSENT_ACCEPTED_EVENT
 * are canonically exported from src/lib/shared-ui.ts but DUPLICATED as
 * string literals in three component scripts: CookieConsent's bundled
 * module cannot see frontmatter imports, and AdsterraSlot / MobileAnchorAd
 * run untranspiled is:inline scripts that cannot import at all.
 *
 * fail-closed direction: any single-sided rename means consumers can no
 * longer read the stored choice and the accept event never fires — ads
 * silently never load. This suite pins every duplicate to the canonical
 * export so a partial rename goes red instead.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string) => readFileSync(join(root, rel), 'utf8');

/** Each consumer's own assignment idiom for the two literals. */
const CONSUMERS: { file: string; keyRe: RegExp; eventRe: RegExp }[] = [
  {
    file: 'src/components/layout/CookieConsent.astro',
    keyRe: /const KEY = '([^']+)'/,
    eventRe: /const ACCEPTED_EVENT = '([^']+)'/,
  },
  {
    file: 'src/components/ads/AdsterraSlot.astro',
    keyRe: /var CONSENT_KEY = '([^']+)'/,
    eventRe: /var CONSENT_EVENT = '([^']+)'/,
  },
  {
    file: 'src/components/ads/MobileAnchorAd.astro',
    keyRe: /var CONSENT_KEY = '([^']+)'/,
    eventRe: /var CONSENT_EVENT = '([^']+)'/,
  },
];

describe('consent literals pinned to shared-ui.ts', () => {
  const sharedUi = read('src/lib/shared-ui.ts');
  const storageKey = /export const CONSENT_STORAGE_KEY = '([^']+)'/.exec(sharedUi)?.[1];
  const acceptedEvent = /export const CONSENT_ACCEPTED_EVENT = '([^']+)'/.exec(sharedUi)?.[1];

  test('shared-ui.ts still exports both canonical constants', () => {
    expect(storageKey, 'CONSENT_STORAGE_KEY export missing in shared-ui.ts').toBeTruthy();
    expect(acceptedEvent, 'CONSENT_ACCEPTED_EVENT export missing in shared-ui.ts').toBeTruthy();
  });

  for (const { file, keyRe, eventRe } of CONSUMERS) {
    test(`${file} hardcodes the canonical values`, () => {
      const src = read(file);
      const key = keyRe.exec(src)?.[1];
      const event = eventRe.exec(src)?.[1];
      expect(key, `${file}: storage-key literal not found or drifted`).toBe(storageKey);
      expect(event, `${file}: accepted-event literal not found or drifted`).toBe(acceptedEvent);
    });
  }
});
