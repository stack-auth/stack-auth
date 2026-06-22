// `dist/vercel.mjs` is the tsdown-built bundle that only exists after `turbo build`.
// `api/index.ts` must import the built bundle at runtime (so Vercel traces the right
// externalized deps), but TS can't resolve it before a build. Type it from the source
// entry so the editor and the Vercel `@vercel/node` builder get full type fidelity.
declare module "*/dist/vercel.mjs" {
  const app: typeof import("../src/server/vercel").default;
  export default app;
}
