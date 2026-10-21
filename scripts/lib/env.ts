/**
 * Local .env loading for standalone scripts.
 *
 * Astro/Vite loads `.env` into `process.env` during a build, but a script
 * run directly through tsx/node does not — so a script that reads
 * `process.env.SITE_URL` would see a different value (or none) than the site
 * it operates on. `loadLocalEnv` closes that gap.
 *
 * Existing process.env values WIN: a real environment variable (CI, the
 * Cloudflare dashboard) must not be overwritten by a developer's local file.
 * A missing file is a no-op.
 */

import * as path from 'node:path';

/**
 * Load a local .env file into process.env.
 *
 * @param filePath path to the .env file (absolute or relative to cwd)
 */
export function loadLocalEnv(filePath = '.env'): void {
  try {
    process.loadEnvFile(path.resolve(filePath));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    console.warn(
      `⚠️ Could not parse ${filePath} (${error instanceof Error ? error.message : String(error)}) — continuing with the process environment only.`,
    );
  }
}
