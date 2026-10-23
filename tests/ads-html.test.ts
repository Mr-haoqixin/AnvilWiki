import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const adsDir = join(root, 'public/ads');

// A fresh fork deletes the demo units, so an empty directory is valid.
const files = existsSync(adsDir)
  ? readdirSync(adsDir).filter((name) => name.endsWith('.html'))
  : [];

describe.skipIf(files.length === 0)('public/ads/*.html', () => {
  test.each(files)('%s is a complete, non-indexable document', (file) => {
    const html = readFileSync(join(adsDir, file), 'utf8').toLowerCase();

    // Pagefind warns "has no <html> element" and skips bare script fragments.
    expect(html).toMatch(/^<!doctype html>/);
    expect(html).toContain('<html');
    expect(html).toContain('</html>');
    expect(html).toContain('<body');
    expect(html).toContain('</body>');

    // Ad units are iframe payloads, never content: keep crawlers and site
    // search out of them even though they are served as public documents.
    expect(html).toMatch(/<meta\s+name="robots"[^>]*noindex/);
    expect(html).toContain('data-pagefind-ignore');

    // The Adsterra snippet itself must survive the wrapper.
    expect(html).toContain('<script');
  });
});
