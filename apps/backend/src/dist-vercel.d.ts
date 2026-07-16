declare module "*/dist/vercel.mjs" {
  import type { Elysia } from "elysia";

  const app: Elysia;
  export default app;
}
