declare module "oidc-provider/lib/shared/session.js" {
  const sessionMiddleware: Parameters<import("oidc-provider").default["use"]>[0];
  export default sessionMiddleware;
}
