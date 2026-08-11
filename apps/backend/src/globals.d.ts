declare module "oidc-provider/lib/shared/session.js" {
  const sessionMiddleware: Parameters<import("koa").Middleware>[0];
  export default sessionMiddleware;
}
