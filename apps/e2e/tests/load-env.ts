import dotenv from "dotenv";
import path from "path";

// Loaded as the first `setupFiles` entry (NOT as a vitest `globalSetup`).
//
// A `globalSetup` runs once in vitest's main process, and any `process.env`
// mutation it makes is inherited by every worker thread that vitest spawns
// afterwards — including workers running unrelated projects. That leaks this
// app's dev env (e.g. NEXT_PUBLIC_HEXCLAVE_HOSTED_HANDLER_DOMAIN_SUFFIX) into
// the hermetic SDK unit tests in packages/*, breaking assertions that expect
// production defaults. `setupFiles` run per-project inside the worker, so the
// env stays scoped to this project's tests and does not leak.
//
// This must be the first setupFile so the env is populated before setup.ts (and
// the helpers it imports) is evaluated.
dotenv.config({
  path: [
    ".env.test.local",
    ".env.test",
    ".env.development.local",
    ".env.local",
    ".env.development",
    ".env",
  ].map((file) => path.resolve(__dirname, "..", file)),
});
