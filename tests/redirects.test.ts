import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('public/_redirects', () => {
  const redirects = readFileSync(join(root, 'public/_redirects'), 'utf8');

  test('retains the default-locale alias + retired-locale (es/nl) 301s', () => {
    const rules = redirects
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'));

    expect(rules).toEqual([
      '/en/ /',
      '/en /',
      '/es / 301',
      '/es/* /:splat 301',
      '/nl / 301',
      '/nl/* /:splat 301',
    ]);
  });

  test('does not redirect removed project-site URLs', () => {
    expect(redirects).not.toContain('/landing');
    expect(redirects).not.toContain('/zh ');
  });
});
