import { createFileRoute, useLocation } from "@tanstack/react-router"
import { StackHandler } from "@stackframe/tanstack-start"

/**
 * Single splat route for every auth page (sign-in, sign-up, forgot-password,
 * email-verification, oauth-callback, …). The Stack SDK figures out which
 * sub-page to render from the URL relative to `stackApp.urls.handler`.
 */
export const Route = createFileRoute("/handler/$")({
  // The SDK's StackHandlerClient reads `window.location.search` during
  // render, so SSR-rendering it would crash. Auth pages don't benefit from
  // SSR anyway — render client-only.
  ssr: false,
  component: AuthHandlerRoute,
})

function AuthHandlerRoute() {
  const { pathname } = useLocation()
  return <StackHandler fullPage location={pathname} />
}
