/**
 * Centralized environment-variable reads for the SDK.
 *
 * Keep each key explicit and reference `process.env.KEY` directly so bundlers
 * like Next.js can inline values at build time.
 *
 * Hexclave rebrand: each getter prefers the HEXCLAVE_*-prefixed literal and
 * falls back to the legacy STACK_* literal(s). Both operands stay literal
 * `process.env.X` references so bundlers can inline them. The port-prefix var
 * is a straight rename (no dual-read).
 */
export const envVars = {
  // Hexclave rebrand: port-prefix var renamed outright (no dual-read).
  get NEXT_PUBLIC_HEXCLAVE_PORT_PREFIX() {
    return (typeof process !== "undefined" ? process.env.NEXT_PUBLIC_HEXCLAVE_PORT_PREFIX : undefined) ?? undefined;
  },
  get NEXT_PUBLIC_STACK_PROJECT_ID() {
    return (typeof process !== "undefined" ? process.env.NEXT_PUBLIC_HEXCLAVE_PROJECT_ID ?? process.env.NEXT_PUBLIC_STACK_PROJECT_ID : undefined) ?? undefined;
  },
  get STACK_PROJECT_ID() {
    return (typeof process !== "undefined" ? process.env.HEXCLAVE_PROJECT_ID ?? process.env.STACK_PROJECT_ID : undefined) ?? undefined;
  },
  get NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY() {
    return (typeof process !== "undefined" ? process.env.NEXT_PUBLIC_HEXCLAVE_PUBLISHABLE_CLIENT_KEY ?? process.env.NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY : undefined) ?? undefined;
  },
  get STACK_PUBLISHABLE_CLIENT_KEY() {
    return (typeof process !== "undefined" ? process.env.HEXCLAVE_PUBLISHABLE_CLIENT_KEY ?? process.env.STACK_PUBLISHABLE_CLIENT_KEY : undefined) ?? undefined;
  },
  get STACK_SECRET_SERVER_KEY() {
    return (typeof process !== "undefined" ? process.env.HEXCLAVE_SECRET_SERVER_KEY ?? process.env.STACK_SECRET_SERVER_KEY : undefined) ?? undefined;
  },
  get STACK_SUPER_SECRET_ADMIN_KEY() {
    return (typeof process !== "undefined" ? process.env.HEXCLAVE_SUPER_SECRET_ADMIN_KEY ?? process.env.STACK_SUPER_SECRET_ADMIN_KEY : undefined) ?? undefined;
  },
  get NEXT_PUBLIC_STACK_EXTRA_REQUEST_HEADERS() {
    return (typeof process !== "undefined" ? process.env.NEXT_PUBLIC_HEXCLAVE_EXTRA_REQUEST_HEADERS ?? process.env.NEXT_PUBLIC_STACK_EXTRA_REQUEST_HEADERS : undefined) ?? undefined;
  },
  get STACK_EXTRA_REQUEST_HEADERS() {
    return (typeof process !== "undefined" ? process.env.HEXCLAVE_EXTRA_REQUEST_HEADERS ?? process.env.STACK_EXTRA_REQUEST_HEADERS : undefined) ?? undefined;
  },
  get NEXT_PUBLIC_BROWSER_STACK_API_URL() {
    return (typeof process !== "undefined" ? process.env.NEXT_PUBLIC_BROWSER_HEXCLAVE_API_URL ?? process.env.NEXT_PUBLIC_BROWSER_STACK_API_URL : undefined) ?? undefined;
  },
  get NEXT_PUBLIC_STACK_API_URL_BROWSER() {
    return (typeof process !== "undefined" ? process.env.NEXT_PUBLIC_HEXCLAVE_API_URL_BROWSER ?? process.env.NEXT_PUBLIC_STACK_API_URL_BROWSER : undefined) ?? undefined;
  },
  get STACK_API_URL_BROWSER() {
    return (typeof process !== "undefined" ? process.env.HEXCLAVE_API_URL_BROWSER ?? process.env.STACK_API_URL_BROWSER : undefined) ?? undefined;
  },
  get NEXT_PUBLIC_SERVER_STACK_API_URL() {
    return (typeof process !== "undefined" ? process.env.NEXT_PUBLIC_SERVER_HEXCLAVE_API_URL ?? process.env.NEXT_PUBLIC_SERVER_STACK_API_URL : undefined) ?? undefined;
  },
  get NEXT_PUBLIC_STACK_API_URL_SERVER() {
    return (typeof process !== "undefined" ? process.env.NEXT_PUBLIC_HEXCLAVE_API_URL_SERVER ?? process.env.NEXT_PUBLIC_STACK_API_URL_SERVER : undefined) ?? undefined;
  },
  get STACK_API_URL_SERVER() {
    return (typeof process !== "undefined" ? process.env.HEXCLAVE_API_URL_SERVER ?? process.env.STACK_API_URL_SERVER : undefined) ?? undefined;
  },
  get NEXT_PUBLIC_STACK_API_URL() {
    return (typeof process !== "undefined" ? process.env.NEXT_PUBLIC_HEXCLAVE_API_URL ?? process.env.NEXT_PUBLIC_STACK_API_URL : undefined) ?? undefined;
  },
  get STACK_API_URL() {
    return (typeof process !== "undefined" ? process.env.HEXCLAVE_API_URL ?? process.env.STACK_API_URL : undefined) ?? undefined;
  },
  get NEXT_PUBLIC_STACK_URL() {
    return (typeof process !== "undefined" ? process.env.NEXT_PUBLIC_HEXCLAVE_URL ?? process.env.NEXT_PUBLIC_STACK_URL : undefined) ?? undefined;
  },
  get NEXT_PUBLIC_STACK_HOSTED_HANDLER_DOMAIN_SUFFIX() {
    return (typeof process !== "undefined" ? process.env.NEXT_PUBLIC_HEXCLAVE_HOSTED_HANDLER_DOMAIN_SUFFIX ?? process.env.NEXT_PUBLIC_STACK_HOSTED_HANDLER_DOMAIN_SUFFIX : undefined) ?? undefined;
  },
  get NEXT_PUBLIC_STACK_HOSTED_HANDLER_URL_TEMPLATE() {
    return (typeof process !== "undefined" ? process.env.NEXT_PUBLIC_HEXCLAVE_HOSTED_HANDLER_URL_TEMPLATE ?? process.env.NEXT_PUBLIC_STACK_HOSTED_HANDLER_URL_TEMPLATE : undefined) ?? undefined;
  },
  get NEXT_PUBLIC_STACK_STRIPE_PUBLISHABLE_KEY() {
    return (typeof process !== "undefined" ? process.env.NEXT_PUBLIC_HEXCLAVE_STRIPE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_STACK_STRIPE_PUBLISHABLE_KEY : undefined) ?? undefined;
  },
  get NEXT_PUBLIC_STACK_BOT_CHALLENGE_SITE_KEY() {
    return (typeof process !== "undefined" ? process.env.NEXT_PUBLIC_HEXCLAVE_BOT_CHALLENGE_SITE_KEY ?? process.env.NEXT_PUBLIC_STACK_BOT_CHALLENGE_SITE_KEY : undefined) ?? undefined;
  },
  get NEXT_PUBLIC_STACK_BOT_CHALLENGE_INVISIBLE_SITE_KEY() {
    return (typeof process !== "undefined" ? process.env.NEXT_PUBLIC_HEXCLAVE_BOT_CHALLENGE_INVISIBLE_SITE_KEY ?? process.env.NEXT_PUBLIC_STACK_BOT_CHALLENGE_INVISIBLE_SITE_KEY : undefined) ?? undefined;
  },
  get NODE_ENV() {
    return (typeof process !== "undefined" ? process.env.NODE_ENV : undefined) ?? undefined;
  },
  get NEXT_PUBLIC_STACK_IS_LOCAL_EMULATOR() {
    return (typeof process !== "undefined" ? process.env.NEXT_PUBLIC_HEXCLAVE_IS_LOCAL_EMULATOR ?? process.env.NEXT_PUBLIC_STACK_IS_LOCAL_EMULATOR : undefined) ?? undefined;
  },
};
