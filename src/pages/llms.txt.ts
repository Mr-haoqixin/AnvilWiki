/**
 * llms.txt (/llms.txt) — a Markdown "site map" for LLMs (ChatGPT, Perplexity,
 * Claude, etc.) proposed by Jeremy Howard and now a de-facto standard for
 * AI-search visibility.
 *
 * Generated at build time from the wiki Content Collection:
 *   - site intro (name + description)
 *   - every default-locale article: title, absolute URL, one-line summary
 *
 * Game-wiki queries ("how to beat X", "latest codes") increasingly land in
 * AI chatbots; listing content here costs nothing and helps AI crawlers
 * discover and cite the site.
 */
import type { APIRoute } from 'astro';
import { site, siteUrl } from '~/config/site';
import { getCollection } from 'astro:content';
import { parseEntryId } from '~/lib/content';
import { defaultLocale } from '~/i18n/routing';
import { detailPath } from '~/lib/url';
import { newestFirst } from '~/lib/content-utils';

/**
 * llms.txt entries are ONE Markdown list item per line (`- [title](url): summary`).
 * escapeLinkText keeps a title containing [ or ] from breaking the link shape
 * (backslash escaped first so the added \ can't be double-interpreted);
 * oneLine folds ALL whitespace — a summary with an embedded newline would
 * split one entry into two broken lines.
 */
function escapeLinkText(text: string): string {
  return text.replace(/[\\[\]]/g, '\\$&');
}
function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export const GET: APIRoute = async () => {
  const all = await getCollection('wiki');
  const entries = all
    .filter((e) => {
      const parsed = parseEntryId(e.id);
      return parsed?.locale === defaultLocale && !e.data.noindex && !e.data.draft;
    })
    .sort(
      (a, b) => a.data.category.localeCompare(b.data.category, defaultLocale) || newestFirst(a, b),
    );

  const lines: string[] = [
    `# ${site.name}`,
    '',
    `> ${site.description}`,
    '',
    `Wiki for ${site.game.name} (${site.game.platform}, by ${site.game.developer}).`,
    '',
    '## Articles',
    '',
  ];

  for (const e of entries) {
    const parsed = parseEntryId(e.id);
    const slug = parsed?.slug ?? '';
    const url = `${siteUrl}${detailPath(e.data.category, slug, defaultLocale)}`;
    const summary = e.data.summary ?? e.data.description;
    lines.push(`- [${escapeLinkText(e.data.title)}](${url}): ${oneLine(summary)}`);
  }

  return new Response(lines.join('\n') + '\n', {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
};
