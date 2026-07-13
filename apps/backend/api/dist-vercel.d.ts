declare module "*/dist/vercel.mjs" {
  const app: typeof import("../src/server/vercel").default;
  export default app;
}
