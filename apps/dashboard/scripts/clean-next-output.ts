import * as fs from 'node:fs/promises';
import * as path from 'node:path';

async function cleanDistDir(distDir: string) {
  let entries;
  try {
    entries = await fs.readdir(distDir);
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return;
    throw error;
  }

  await Promise.all(
    entries
      .filter((entry) => entry !== 'cache')
      .map((entry) => fs.rm(path.join(distDir, entry), { force: true, recursive: true })),
  );
  await fs.rm(path.join(distDir, 'cache', 'turbopack'), { force: true, recursive: true });
}

async function main() {
  // Turbopack's persistent cache can reach a state where the emitted runtime chunk lacks the
  // async-module helper that the generated PostCSS config loader calls, which fails the build with
  // `TypeError: __turbopack_context__.a is not a function`. Start every build from clean output.
  // Only the dist dir this build actually writes to: a development environment running in parallel
  // owns its own output directory, and wiping it would break that session mid-flight.
  await cleanDistDir(process.env.HEXCLAVE_DASHBOARD_NEXT_DIST_DIR ?? '.next');
}

main().catch((error) => {
  console.error('[Clean Next Output] Failed to clean Next.js output:', error);
  process.exit(1);
});
