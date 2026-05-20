/**
 * Workaround for https://github.com/vercel/next.js/issues/91661
 *
 * Next.js 16.2 doesn't include `.next/package.json` (the CJS boundary marker)
 * in the `required-server-files.json` manifest. Without it, Vercel's serverless
 * functions inherit `"type": "module"` from the project's package.json, causing
 * `require is not defined` at runtime.
 *
 * The upstream fix landed in vercel/next.js#93612 (canary only as of 16.2.6).
 * This script patches the manifest after `next build` to include the file.
 *
 * Remove this script once we upgrade to a stable Next.js release containing the fix.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const distDir = '.next';
const manifestPath = join(distDir, 'required-server-files.json');

if (!existsSync(manifestPath)) {
  // Not all build modes produce this manifest (e.g. compile-only docker builds)
  process.exit(0);
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

const packageJsonEntry = join(distDir, 'package.json');

if (!manifest.files.includes(packageJsonEntry)) {
  manifest.files.push(packageJsonEntry);
  writeFileSync(manifestPath, JSON.stringify(manifest));
  console.log(`Patched ${manifestPath}: added ${packageJsonEntry} to files array`);
} else {
  console.log(`${manifestPath} already includes ${packageJsonEntry}, no patch needed`);
}
