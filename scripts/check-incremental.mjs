#!/usr/bin/env node
/**
 * Incremental-build equivalence guard (experimental.incrementalBuild).
 *
 * A wrong cacheKey is silent: the page renders STALE output while the build
 * stays green — the exact self-contradictory-output class this repo's gates
 * exist to prevent. This script closes that hole: it builds twice — once
 * from the incremental cache, once with --force (cache ignored) — and
 * requires the two dist trees to be byte-identical.
 *
 * Run weekly via .github/workflows/incremental-audit.yml, or manually after
 * touching cacheKey logic (src/lib/build-cache.ts or a route getStaticPaths).
 *
 * Invokes `astro build` directly (NOT `pnpm build`) so the postbuild chain —
 * pagefind, transpile, cache-bust rewrites — stays out of the comparison
 * and the audit costs ~2× the render phase instead of ~2× the full pipeline.
 */
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const dist = join(process.cwd(), 'dist');

const run = (label, args) => {
  console.log(`[check-incremental] ${label}`);
  execSync(`pnpm exec astro build${args ? ` ${args}` : ''}`, {
    stdio: 'inherit',
    shell: true,
  });
};

/** rel POSIX path → sha256, over every file in dist. */
function snapshot() {
  const files = new Map();
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) {
        walk(p);
      } else {
        const rel = relative(dist, p).split(sep).join('/');
        files.set(rel, createHash('sha256').update(readFileSync(p)).digest('hex'));
      }
    }
  };
  walk(dist);
  return files;
}

const t0 = Date.now();
run('build #1 — incremental cache if present', '');
const cached = snapshot();
const t1 = Date.now();
run('build #2 — forced (cache ignored)', '--force');
const forced = snapshot();
const t2 = Date.now();

console.log(
  `[check-incremental] build #1 ${Math.round((t1 - t0) / 1000)}s (${cached.size} files), ` +
    `build #2 ${Math.round((t2 - t1) / 1000)}s (${forced.size} files)`,
);

const diffs = [];
for (const [rel, hash] of cached) {
  if (!forced.has(rel)) diffs.push(`only-in-cached: ${rel}`);
  else if (forced.get(rel) !== hash) diffs.push(`content-differs: ${rel}`);
}
for (const rel of forced.keys()) {
  if (!cached.has(rel)) diffs.push(`only-in-forced: ${rel}`);
}

if (diffs.length > 0) {
  console.error(`[check-incremental] ❌ ${diffs.length} difference(s) between cached and forced dist:`);
  for (const d of diffs.slice(0, 20)) console.error(`  ${d}`);
  if (diffs.length > 20) console.error(`  … and ${diffs.length - 20} more`);
  console.error(
    'A cacheKey is restoring pages that should have changed — see src/lib/build-cache.ts ' +
      '(and the four content routes) for what the key must fold in.',
  );
  process.exit(1);
}

console.log(`[check-incremental] ✅ cached and forced builds are byte-identical (${cached.size} files)`);
