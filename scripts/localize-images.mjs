#!/usr/bin/env node
/**
 * localize-images.mjs — replace external image hotlinks in wiki content with
 * locally cached copies under public/images/external/<host>/.
 *
 * Why: every hotlinked image is a慢性 single point of failure held by a
 * third party we cannot control (imgckr is a small free host, weki.gg is a
 * beta site, glimmerwick.wiki is a third wiki's server) — when any of them
 * changes URL or dies, pages ship dead images with zero monitoring on our
 * side (check-links only audits internal links). Local copies ride the same
 * Cloudflare CDN as the site itself and kill the cross-origin DNS/TLS cost
 * for mainland-China readers. ~50 assets ≈ a few MB against 22 MB of
 * existing generated covers. Source attribution stays in the alt text /
 * surrounding prose, which is untouched.
 *
 * All-or-nothing: if ANY download fails, nothing is rewritten (exit 1) —
 * the same contract as sync-codes / bulk-new-posts.
 *
 * Usage:
 *   node scripts/localize-images.mjs --dry-run   # list the plan, change nothing
 *   node scripts/localize-images.mjs             # download + rewrite MDX
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';

const ROOT = process.cwd();
const CONTENT_BASE = path.resolve(ROOT, 'src/content/wiki');
const OUT_BASE_REL = 'public/images/external';
const DRY_RUN = process.argv.includes('--dry-run');

// MD image syntax ![alt](https://…) and <img … src="https://…">.
const REF_RE = /(!\[[^\]]*\]\(|<img\s[^>]*src=")(https:\/\/[^)\s"]+)/g;

/** Recursively collect .mdx files. */
function walkMdx(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walkMdx(p, out);
    else if (entry.name.endsWith('.mdx')) out.push(p);
  }
  return out;
}

const hostDir = (host) => host.replace(/^www\./, '').replace(/[^a-z0-9.-]/gi, '-');
const sanitize = (name) => name.replace(/[^A-Za-z0-9._-]/g, '-').replace(/^\.+/, '');

/** Stable local name for a URL: host dir + basename (+ hash when colliding). */
function planName(url, taken) {
  const u = new URL(url);
  const base = sanitize(path.basename(u.pathname)) || 'image';
  let name = base;
  if (!/\.[a-z0-9]{2,5}$/i.test(name)) name += '.img'; // extension decided after download
  if (taken.has(name)) name = `${path.basename(name, path.extname(name))}-${createHash('sha256').update(url).digest('hex').slice(0, 8)}${path.extname(name)}`;
  taken.add(name);
  return path.join(hostDir(u.hostname), name);
}

async function download(url, destAbs) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'user-agent': 'AnvilWiki localize-images (one-time asset cache)' },
        redirect: 'follow',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 100) throw new Error(`suspiciously small (${buf.length} bytes)`);
      let out = destAbs;
      // Fix the extension when the URL had none/placeholder (content-type first).
      if (/\.(img|bin)$/i.test(destAbs)) {
        const ct = res.headers.get('content-type') ?? '';
        const ext = ct.includes('png') ? 'png' : ct.includes('webp') ? 'webp' : ct.includes('gif') ? 'gif' : ct.includes('svg') ? 'svg' : ct.includes('jpeg') || ct.includes('jpg') ? 'jpg' : 'bin';
        out = destAbs.replace(/\.(img|bin)$/i, `.${ext}`);
      }
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, buf);
      return { bytes: buf.length, path: out };
    } catch (err) {
      if (attempt === 3) throw new Error(`${url}: ${err.message}`);
      await new Promise((r) => setTimeout(r, attempt * 1000));
    }
  }
  throw new Error('unreachable');
}

// ---------------------------------------------------------------------------
// Scan
// ---------------------------------------------------------------------------
const files = walkMdx(CONTENT_BASE);
const urlToLocal = new Map(); // url -> rel path (/images/external/...)
const fileRefs = []; // { file, urls: Set }
const takenNames = new Set();

for (const file of files) {
  const src = fs.readFileSync(file, 'utf8');
  const urls = new Set();
  for (const m of src.matchAll(REF_RE)) urls.add(m[2]);
  if (urls.size === 0) continue;
  fileRefs.push({ file, urls });
  for (const url of urls) {
    if (urlToLocal.has(url)) continue;
    const relName = planName(url, takenNames);
    // Web path: public/ maps to the site root, so /images/external/… .
    urlToLocal.set(url, `/images/external/${relName.split(path.sep).join('/')}`);
  }
}

const byHost = new Map();
for (const url of urlToLocal.keys()) {
  const h = new URL(url).hostname;
  byHost.set(h, (byHost.get(h) ?? 0) + 1);
}

console.log(`\n🖼️  External image scan — ${fileRefs.length} MDX files, ${urlToLocal.size} unique assets`);
for (const [host, n] of byHost) console.log(`   ${host}: ${n}`);
if (urlToLocal.size === 0) {
  console.log('\n✅ Nothing to localize.');
  process.exit(0);
}
if (DRY_RUN) {
  for (const [url, local] of urlToLocal) console.log(`   ${url}\n     → ${local}`);
  console.log('\nDry run — nothing written. Re-run without --dry-run to download + rewrite.');
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Download (all-or-nothing)
// ---------------------------------------------------------------------------
const results = [];
const failures = [];
const deadUrls = []; // 404 at source: the hotlink is ALREADY broken on the live site — drop the ref.
for (const [url, local] of urlToLocal) {
  try {
    const { bytes, path: abs } = await download(url, path.join(ROOT, 'public', local.replace(/^\//, '')));
    results.push({ url, local: '/' + path.relative(path.resolve(ROOT, 'public'), abs).split(path.sep).join('/'), bytes });
    console.log(`   ✅ ${url} → ${results[results.length - 1].local} (${(bytes / 1024).toFixed(1)} KB)`);
  } catch (err) {
    if (/HTTP 404/.test(err.message)) {
      deadUrls.push(url);
      console.error(`   ☠️  ${url} — 404 at source (already dead on the live site; its ref will be removed)`);
    } else {
      failures.push(String(err.message));
      console.error(`   ❌ ${err.message}`);
    }
  }
}
if (failures.length > 0) {
  console.error(`\n❌ ${failures.length} download(s) failed — NOTHING rewritten (all-or-nothing). Fix or remove the refs and re-run.`);
  // Roll back partial downloads so a re-run starts clean.
  for (const r of results) fs.rmSync(path.join(ROOT, 'public', r.local.replace(/^\//, '')), { force: true });
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Rewrite MDX references (URL → local path; alt text / attrs untouched),
// and strip refs whose source is already dead (404) — they render broken
// images today, so removing them is a strict improvement.
// ---------------------------------------------------------------------------
const deadSet = new Set(deadUrls);
let rewritten = 0;
for (const { file, urls } of fileRefs) {
  let src = fs.readFileSync(file, 'utf8');
  const before = src;
  for (const url of urls) {
    if (deadSet.has(url)) {
      // Remove the whole image construct: ![alt](url) or <img …src="url"…>.
      const mdImg = new RegExp(`!\\[[^\\]]*\\]\\(${url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\)`, 'g');
      const imgTag = new RegExp(`<img\\s[^>]*src="${url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*>`, 'g');
      src = src.replace(mdImg, '').replace(imgTag, '');
    } else {
      src = src.split(url).join(urlToLocal.get(url));
    }
  }
  if (src !== before) {
    // Collapse lines the removal left empty (avoid double blank lines).
    src = src.replace(/\n[ \t]+\n/g, '\n\n').replace(/\n{3,}/g, '\n\n');
    fs.writeFileSync(file, src, 'utf8');
    rewritten++;
  }
}
if (deadUrls.length > 0) {
  console.log(`\n☠️  Dropped ${deadUrls.length} already-dead image ref(s) (404 at source):`);
  for (const u of deadUrls) console.log(`   ${u}`);
}

const totalKb = results.reduce((s, r) => s + r.bytes, 0);
console.log(
  `\n📊 Cached ${results.length} assets (${(totalKb / 1024).toFixed(1)} KB) under public/images/external/; rewrote ${rewritten} MDX files.`,
);
