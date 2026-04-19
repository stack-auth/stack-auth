/**
 * Centralized environment-variable reads for the SDK.
 *
 * Keep each key explicit and reference `process.env.KEY` directly so bundlers
 * like Next.js can inline values at build time.
 */
export const envVars = {
  get NEXT_PUBLIC_STACK_PORT_PREFIX() {
    return (typeof process !== "undefined" ? process.env.NEXT_PUBLIC_STACK_PORT_PREFIX : undefined) ?? undefined;
  },
  get NEXT_PUBLIC_STACK_PROJECT_ID() {
    return (typeof process !== "undefined" ? process.env.NEXT_PUBLIC_STACK_PROJECT_ID : undefined) ?? undefined;
  },
  get STACK_PROJECT_ID() {
    return (typeof process !== "undefined" ? process.env.STACK_PROJECT_ID : undefined) ?? undefined;
  },
  get NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY() {
    return (typeof process !== "undefined" ? process.env.NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY : undefined) ?? undefined;
  },
  get STACK_PUBLISHABLE_CLIENT_KEY() {
    return (typeof process !== "undefined" ? process.env.STACK_PUBLISHABLE_CLIENT_KEY : undefined) ?? undefined;
  },
  get STACK_SECRET_SERVER_KEY() {
    return (typeof process !== "undefined" ? process.env.STACK_SECRET_SERVER_KEY : undefined) ?? undefined;
  },
  get STACK_SUPER_SECRET_ADMIN_KEY() {
    return (typeof process !== "undefined" ? process.env.STACK_SUPER_SECRET_ADMIN_KEY : undefined) ?? undefined;
  },
  get NEXT_PUBLIC_STACK_EXTRA_REQUEST_HEADERS() {
    return (typeof process !== "undefined" ? process.env.NEXT_PUBLIC_STACK_EXTRA_REQUEST_HEADERS : undefined) ?? undefined;
  },
  get STACK_EXTRA_REQUEST_HEADERS() {
    return (typeof process !== "undefined" ? process.env.STACK_EXTRA_REQUEST_HEADERS : undefined) ?? undefined;
  },
  get NEXT_PUBLIC_BROWSER_STACK_API_URL() {
    return (typeof process !== "undefined" ? process.env.NEXT_PUBLIC_BROWSER_STACK_API_URL : undefined) ?? undefined;
  },
  get NEXT_PUBLIC_STACK_API_URL_BROWSER() {
    return (typeof process !== "undefined" ? process.env.NEXT_PUBLIC_STACK_API_URL_BROWSER : undefined) ?? undefined;
  },
  get STACK_API_URL_BROWSER() {
    return (typeof process !== "undefined" ? process.env.STACK_API_URL_BROWSER : undefined) ?? undefined;
  },
  get NEXT_PUBLIC_SERVER_STACK_API_URL() {
    return (typeof process !== "undefined" ? process.env.NEXT_PUBLIC_SERVER_STACK_API_URL : undefined) ?? undefined;
  },
  get NEXT_PUBLIC_STACK_API_URL_SERVER() {
    return (typeof process !== "undefined" ? process.env.NEXT_PUBLIC_STACK_API_URL_SERVER : undefined) ?? undefined;
  },
  get STACK_API_URL_SERVER() {
    return (typeof process !== "undefined" ? process.env.STACK_API_URL_SERVER : undefined) ?? undefined;
  },
  get NEXT_PUBLIC_STACK_API_URL() {
    return (typeof process !== "undefined" ? process.env.NEXT_PUBLIC_STACK_API_URL : undefined) ?? undefined;
  },
  get STACK_API_URL() {
    return (typeof process !== "undefined" ? process.env.STACK_API_URL : undefined) ?? undefined;
  },
  get NEXT_PUBLIC_STACK_URL() {
    return (typeof process !== "undefined" ? process.env.NEXT_PUBLIC_STACK_URL : undefined) ?? undefined;
  },
  get NEXT_PUBLIC_STACK_HOSTED_HANDLER_DOMAIN_SUFFIX() {
    return (typeof process !== "undefined" ? process.env.NEXT_PUBLIC_STACK_HOSTED_HANDLER_DOMAIN_SUFFIX : undefined) ?? undefined;
  },
  get NEXT_PUBLIC_STACK_HOSTED_HANDLER_URL_TEMPLATE() {
    return (typeof process !== "undefined" ? process.env.NEXT_PUBLIC_STACK_HOSTED_HANDLER_URL_TEMPLATE : undefined) ?? undefined;
  },
  get NEXT_PUBLIC_STACK_STRIPE_PUBLISHABLE_KEY() {
    return (typeof process !== "undefined" ? process.env.NEXT_PUBLIC_STACK_STRIPE_PUBLISHABLE_KEY : undefined) ?? undefined;
  },
  get NEXT_PUBLIC_STACK_BOT_CHALLENGE_SITE_KEY() {
    return (typeof process !== "undefined" ? process.env.NEXT_PUBLIC_STACK_BOT_CHALLENGE_SITE_KEY : undefined) ?? undefined;
  },
  get NEXT_PUBLIC_STACK_BOT_CHALLENGE_INVISIBLE_SITE_KEY() {
    return (typeof process !== "undefined" ? process.env.NEXT_PUBLIC_STACK_BOT_CHALLENGE_INVISIBLE_SITE_KEY : undefined) ?? undefined;
  },
  get NODE_ENV() {
    return (typeof process !== "undefined" ? process.env.NODE_ENV : undefined) ?? undefined;
  },
  get NEXT_PUBLIC_STACK_IS_LOCAL_EMULATOR() {
    return (typeof process !== "undefined" ? process.env.NEXT_PUBLIC_STACK_IS_LOCAL_EMULATOR : undefined) ?? undefined;
  },
};
