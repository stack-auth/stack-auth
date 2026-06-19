// Vercel serverless entry for the Elysia backend.
//
// We do NOT bundle the whole backend graph here (the `@/*` and `next/*` alias
// resolution + heavy native deps are handled by tsdown). Instead this thin
// function re-exports the already-built handler bundle (`dist/vercel.mjs`,
// produced by `tsdown` during `turbo build`), and Vercel's function builder
// only has to trace the externalized native deps (prisma, sharp, bcrypt,
// oidc-provider, pg) from node_modules.
//
// All requests are routed here via the `rewrites` rule in vercel.json, so the
// Elysia app does its own routing/version-rewrite against the original URL.
import app from "../dist/vercel.mjs";

export const config = {
  runtime: "nodejs",
  maxDuration: 60,
};

export default function handler(request: Request): Response | Promise<Response> {
  return app.handle(request);
}
