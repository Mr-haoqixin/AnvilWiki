import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Codes page ↔ homepage highlight consistency (第 23 轮 24h 审计发现①②的门禁半边).
 *
 * A code's status lives in exactly one place — the codes page frontmatter —
 * while two surfaces re-state it by hand and can silently lag behind:
 *
 *   1. `home.explore` badge-list highlights (en/ja): v2.35.0 (中-2) gated
 *      "expired shown as Active" in refresh-audit; this suite pins the
 *      remaining deterministic half in CI — highlight labels must equal the
 *      codes page's active set (both directions). A freshness batch that
 *      rotates codes must touch both surfaces in the same PR or this goes red.
 *   2. The body's test-pass date sentence: freshness batches that bump
 *      frontmatter lastModified but leave the intro's re-test date behind go
 *      red (the Sep 7 vs Sep 22 drift that shipped in 18a99c1).
 *   3. Title/description month anchors: the "(September 2026)" SERP face.
 *      The Oct 1 flip in ecc366b (#67) rotated summary + body + highlights
 *      but left title/description on September — breaking acf46a7's practice
 *      that a freshness batch moves title/description/summary together. When
 *      a month anchor is present it must equal lastModified's month; absent
 *      anchors degrade to a pass like check 2.
 *
 * All checks are clock-free. A missing date sentence degrades to a pass,
 * mirroring refresh-audit's conservative fallback — but an unparseable
 * sentence that IS present still fails.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LOCALES = ['en', 'ja'] as const;

const MONTHS: Record<string, string> = {
  January: '01',
  February: '02',
  March: '03',
  April: '04',
  May: '05',
  June: '06',
  July: '07',
  August: '08',
  September: '09',
  October: '10',
  November: '11',
  December: '12',
};

interface CodeEntry {
  code: string;
  status: string;
}

interface Highlight {
  label?: string;
}

interface LocaleJson {
  home?: {
    explore?: {
      modules?: Array<{ displayType?: string; highlights?: Highlight[] }>;
    };
  };
}

function readCodesPage(locale: string): string {
  return readFileSync(join(ROOT, 'src/content/wiki', locale, 'codes/all-codes.mdx'), 'utf8');
}

function frontmatterOf(raw: string): string {
  return raw.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? '';
}

function bodyOf(raw: string): string {
  const closing = raw.indexOf('\n---', 3);
  return closing === -1 ? '' : raw.slice(closing + 4);
}

function activeCodes(fm: string): string[] {
  const entries: CodeEntry[] = [];
  let current: CodeEntry | null = null;
  for (const line of fm.split(/\r?\n/)) {
    const code = line.match(/^\s*- code:\s*(.+?)\s*$/);
    if (code) {
      current = { code: code[1].replace(/^['"]|['"]$/g, ''), status: '' };
      entries.push(current);
      continue;
    }
    const status = line.match(/^\s+status:\s*(.+?)\s*$/);
    if (status && current) current.status = status[1].replace(/^['"]|['"]$/g, '').toLowerCase();
  }
  return entries.filter((e) => e.status === 'active').map((e) => e.code);
}

function highlightLabels(locale: string): string[] {
  const json = JSON.parse(readFileSync(join(ROOT, 'src/locales', `${locale}.json`), 'utf8')) as LocaleJson;
  const labels: string[] = [];
  for (const m of json.home?.explore?.modules ?? []) {
    if (m?.displayType !== 'badge-list') continue;
    for (const h of m?.highlights ?? []) {
      if (h?.label) labels.push(h.label);
    }
  }
  return labels;
}

function lastModifiedOf(fm: string): string | undefined {
  return fm.match(/^lastModified:\s*(\d{4}-\d{2}-\d{2})\s*$/m)?.[1];
}

/** Normalize the body's test-pass sentence to ISO `YYYY-MM-DD`, or undefined. */
function bodyTestPassDate(locale: string, body: string): string | undefined {
  if (locale === 'en') {
    const m = body.match(/full test history for this pass is ([A-Za-z]+) (\d{1,2}), (\d{4})/);
    const mm = m ? MONTHS[m[1]] : undefined;
    return m && mm ? `${m[3]}-${mm}-${m[2].padStart(2, '0')}` : undefined;
  }
  const m = body.match(/今回の検証日は(\d{4})年(\d{1,2})月(\d{1,2})日/);
  return m ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : undefined;
}

function frontmatterLine(fm: string, key: string): string {
  return fm.match(new RegExp(`^${key}:.*$`, 'm'))?.[0] ?? '';
}

/** Normalize the first `Month YYYY` (en) / `YYYY年M月` (ja) fragment on a
 *  frontmatter line to `YYYY-MM`, or undefined when it carries no month
 *  anchor (words that aren't month names don't count). */
function monthAnchorOf(line: string, locale: string): string | undefined {
  if (locale === 'en') {
    const m = line.match(/([A-Za-z]+)\s+(\d{4})/);
    const mm = m ? MONTHS[m[1]] : undefined;
    return m && mm ? `${m[2]}-${mm}` : undefined;
  }
  const m = line.match(/(\d{4})年(\d{1,2})月/);
  return m ? `${m[1]}-${m[2].padStart(2, '0')}` : undefined;
}

describe('codes page ↔ home highlights consistency', () => {
  for (const locale of LOCALES) {
    it(`${locale}: home badge-list highlights mirror the codes page active set`, () => {
      const active = activeCodes(frontmatterOf(readCodesPage(locale)));
      expect(active.length, 'codes page should have at least one active code').toBeGreaterThan(0);
      expect(highlightLabels(locale).sort()).toEqual([...active].sort());
    });

    it(`${locale}: body test-pass date equals frontmatter lastModified`, () => {
      const raw = readCodesPage(locale);
      const lastModified = lastModifiedOf(frontmatterOf(raw));
      expect(lastModified, 'codes frontmatter should pin lastModified').toBeTruthy();
      const testPassDate = bodyTestPassDate(locale, bodyOf(raw));
      if (!testPassDate) {
        // Sentence absent → nothing to reconcile (refresh-audit's degraded
        // fallback); but a marker that fails to parse is a defect.
        const marker = locale === 'en' ? 'full test history for this pass' : '今回の検証日';
        expect(raw.includes(marker), `test-pass marker present but unparseable in ${locale}`).toBe(false);
        return;
      }
      expect(testPassDate).toBe(lastModified);
    });

    it(`${locale}: title/description month anchors match lastModified month`, () => {
      const fm = frontmatterOf(readCodesPage(locale));
      const lastModified = lastModifiedOf(fm);
      expect(lastModified, 'codes frontmatter should pin lastModified').toBeTruthy();
      const expected = String(lastModified).slice(0, 7);
      for (const key of ['title', 'description'] as const) {
        const anchor = monthAnchorOf(frontmatterLine(fm, key), locale);
        if (anchor) {
          expect(
            anchor,
            `${key} month anchor lags behind lastModified — rotate title/description in the same freshness batch (the Sep title / Oct body drift of #67)`,
          ).toBe(expected);
        }
      }
    });
  }
});
