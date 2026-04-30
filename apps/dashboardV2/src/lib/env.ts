/**
 * Client-safe env values for dashboardV2.
 *
 * IMPORTANT — client/server separation:
 * - Anything exported from this file ends up in the client bundle. Only put
 *   public values here, prefixed with `VITE_STACK_`.
 * - Server-only secrets (e.g. `STACK_SECRET_SERVER_KEY`) MUST NOT live here.
 *   Read those via `process.env.STACK_*` inside TanStack Start server
 *   functions only. The Vite config sets `envPrefix: ["VITE_"]` so the
 *   `STACK_*` prefix can never leak into client code.
 */
function readEnv(key: string): string | undefined {
  const value = (import.meta.env as Record<string, string | undefined>)[key]
  if (value === undefined || value === "") return undefined
  return value
}

export function getPublicEnv(key: string): string | undefined {
  return readEnv(key)
}

export function requirePublicEnv(key: string): string {
  const value = readEnv(key)
  if (value === undefined) {
    throw new Error(
      `Missing required public env var: ${key}. Set it in apps/dashboardV2/.env.development or .env.local. Public vars must be prefixed with VITE_.`,
    )
  }
  return value
}

export const STACK_API_URL = requirePublicEnv("VITE_STACK_API_URL")
export const STACK_PROJECT_ID = requirePublicEnv("VITE_STACK_PROJECT_ID")
export const STACK_PUBLISHABLE_CLIENT_KEY = requirePublicEnv(
  "VITE_STACK_PUBLISHABLE_CLIENT_KEY",
)
