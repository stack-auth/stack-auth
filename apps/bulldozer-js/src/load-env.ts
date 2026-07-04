import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Load .env files for the bulldozer-js process so local/dev runs pick up config (e.g. the Sentry DSN)
// without exporting env vars by hand. This runs in-process (mirroring apps/e2e/tests/global-setup.ts)
// instead of a dotenv-cli script wrapper, so it covers every entrypoint: `pnpm dev`, `pnpm start`, the
// studio/profiling scripts, and a bare `node --import tsx src/index.ts`.
//
// Ordering = precedence: dotenv never overrides an already-set var, so (1) real platform/shell env
// always wins, and (2) the most-specific file listed first wins. `.env*.local` is gitignored and is
// where secrets (a real DSN) live; the committed `.env`/`.env.development` hold only non-secret config.
//
// IMPORTANT: this module must be imported before anything that reads process.env at import time (e.g.
// ./otel.js) or at top level in index.ts — keep it as the first import there.
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

config({
  path: [
    ".env.test.local",
    ".env.test",
    ".env.development.local",
    ".env.local",
    ".env.development",
    ".env",
  ].map(file => resolve(packageRoot, file)),
});
