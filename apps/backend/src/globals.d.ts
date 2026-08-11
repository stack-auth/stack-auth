declare module "oidc-provider/lib/shared/session.js" {
  const sessionMiddleware: import("koa").Middleware;
  export default sessionMiddleware;
}

declare module "oidc-provider/lib/helpers/weak_cache.js" {
  const instance: <T extends object>(provider: T) => {
    configuration(path: "ttl.Session"): number | ((ctx: KoaContextWithOIDC, session: Session) => number);
  };
  export default instance;
}
