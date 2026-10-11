// postbuild-imgckr — transform imgckr.com images in built HTML.
//
// Scans dist/ HTML files for <img src="https://a.imgckr.com/..."> and
// wraps them with lazy-load thumbnail markup.
//
// 缩略图 URL: 在扩展名前插入 .th
//   原图:  https://a.imgckr.com/2026/10/09/Xflue.jpg
//   缩略:  https://a.imgckr.com/2026/10/09/Xflue.th.jpg
import fs from 'fs';
import path from 'path';

const DIST = 'dist';
const IMGCKR_HOST = 'a.imgckr.com';
let count = 0;

function toThumbnail(url) {
  return url.replace(/(\.[^./?#]+)([?#].*)?$/, '.th$1$2');
}

function escapeAttr(s) {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

function transformHtml(html) {
  return html.replace(
    /<img\s+([^>]*?)src="(https:\/\/a\.imgckr\.com\/[^"]+)"([^>]*?)\s*\/?>/g,
    (match, before, src, after) => {
      const fullAttrs = (before + ' ' + after).trim();
      const altMatch = fullAttrs.match(/alt="([^"]*)"/);
      const alt = altMatch ? altMatch[1] : '';
      const thumb = toThumbnail(src);
      count++;
      return `<div class="imgckr-lazy" data-full="${escapeAttr(src)}"><img src="${escapeAttr(thumb)}" alt="${escapeAttr(alt)}" loading="lazy" decoding="async" class="imgckr-thumb" /><noscript><img src="${escapeAttr(src)}" alt="${escapeAttr(alt)}" /></noscript></div>`;
    },
  );
}

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(p);
    } else if (entry.name.endsWith('.html')) {
      const html = fs.readFileSync(p, 'utf8');
      if (!html.includes(IMGCKR_HOST)) continue;
      const transformed = transformHtml(html);
      if (transformed !== html) {
        fs.writeFileSync(p, transformed);
      }
    }
  }
}

if (fs.existsSync(DIST)) {
  walk(DIST);
  console.log(`[imgckr] Transformed ${count} image(s) to lazy-load thumbnails.`);
} else {
  console.log('[imgckr] dist/ not found, skipping.');
}
