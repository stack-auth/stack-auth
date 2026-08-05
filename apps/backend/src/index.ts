// Vercel's Elysia preset finds the entrypoint by scanning known paths (src/index.ts among them)
// for a file that imports the `elysia` package and default-exports the app — see
// https://vercel.com/docs/frameworks/backend/elysia#entrypoint-detection. The bare import below
// exists only to satisfy that scan.
import "elysia";
// Deliberately import the built artifact instead of ./server/app: production must run the exact
// tsdown bundle that CI, the E2E fallback job, and the Docker image validate (bundled workspace
// deps, the createRequire banner, natives left external for Vercel's NFT tracing) and that Sentry
// sourcemaps are uploaded against. Importing source here would make Vercel's bundler recompile the
// backend into an untested artifact. The Vercel build command runs `pnpm run build` before function
// bundling, so dist/vercel.mjs (the no-listen entry; Vercel owns the listener) exists by this point.
import app from "../dist/vercel.mjs";

// Vercel's native Elysia builder delegates to the Node builder, which statically
// reads this exact exported object. Its parser requires a numeric literal here;
// runtime-limits.test.ts keeps this deployment ceiling aligned with the dispatcher.
export const config = {
  maxDuration: 800,
};

export default app;
