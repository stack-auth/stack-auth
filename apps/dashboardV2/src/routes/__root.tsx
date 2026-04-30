import { StackProvider, StackTheme } from "@stackframe/tanstack-start"
import { AgentDevtoolsPanel } from "@barreloflube/tanstack-start-dev-tool-mcp-react"
import { TanStackDevtools } from "@tanstack/react-devtools"
import { QueryClientProvider } from "@tanstack/react-query"
import { ReactQueryDevtoolsPanel } from "@tanstack/react-query-devtools"
import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRouteWithContext,
} from "@tanstack/react-router"
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools"
import { ThemeProvider } from "next-themes"
import { Suspense } from "react"
import appCss from "../styles.css?url"
import type { QueryClient } from "@tanstack/react-query"
import type { ErrorComponentProps } from "@tanstack/react-router"

import { stackApp } from "@/lib/stack/app"
import { Toaster } from "@/components/ui/sonner"
import { Button } from "@/components/ui/button"

const SITE_TITLE = "Stack Auth — Dashboard"
const SITE_DESCRIPTION = "Auth infrastructure for production."
const SITE_URL = "https://app.stack-auth.com"
const SOCIAL_IMAGE_URL = `${SITE_URL}/social-preview.svg`

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: SITE_TITLE },
      { name: "description", content: SITE_DESCRIPTION },
      { name: "application-name", content: "Stack Auth Dashboard" },
      { name: "theme-color", content: "#0a0a0a" },
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: "Stack Auth" },
      { property: "og:title", content: SITE_TITLE },
      { property: "og:description", content: SITE_DESCRIPTION },
      { property: "og:image", content: SOCIAL_IMAGE_URL },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { property: "og:url", content: SITE_URL },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: SITE_TITLE },
      { name: "twitter:description", content: SITE_DESCRIPTION },
      { name: "twitter:image", content: SOCIAL_IMAGE_URL },
      { name: "twitter:url", content: SITE_URL },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", href: "/favicon.ico", sizes: "any" },
      { rel: "apple-touch-icon", href: "/logo.svg" },
      { rel: "manifest", href: "/manifest.json" },
    ],
  }),
  notFoundComponent: NotFound,
  errorComponent: RootErrorBoundary,
  shellComponent: RootDocument,
  component: RootComponent,
})

function RootErrorBoundary({ error }: ErrorComponentProps) {
  console.error(error)
  const message = error instanceof Error ? error.message : String(error)
  return (
    <main className="grid min-h-svh place-items-center px-6">
      <div className="max-w-md space-y-4 text-center">
        <p className="font-mono text-[11px] tracking-[0.18em] text-muted-foreground uppercase">
          Error
        </p>
        <h1 className="font-heading text-4xl font-semibold tracking-tight">
          Something went wrong.
        </h1>
        <p className="text-sm text-muted-foreground">
          The dashboard hit an unexpected error. Try reloading the page.
        </p>
        <pre className="max-h-32 overflow-auto rounded-md border bg-muted/40 p-2 text-left text-[11px] text-muted-foreground">
          {message}
        </pre>
        <Button onClick={() => window.location.reload()}>Reload</Button>
      </div>
    </main>
  )
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext()
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider
        attribute="class"
        defaultTheme="system"
        enableSystem
        disableTransitionOnChange
      >
        <StackProvider app={stackApp}>
          {/* StackTheme injects the SDK's global CSS and the TooltipProvider
              its internal pages (StackHandler, AccountSettings, ...) rely on.
              The Suspense boundary lets the SDK's SSR-suspend resolve. */}
          <StackTheme>
            <Suspense fallback={null}>
              <Outlet />
            </Suspense>
            <Toaster />
          </StackTheme>
        </StackProvider>
      </ThemeProvider>
    </QueryClientProvider>
  )
}

function NotFound() {
  return (
    <main className="grid min-h-svh place-items-center px-6">
      <div className="max-w-md space-y-3 text-center">
        <p className="font-mono text-[11px] tracking-[0.18em] text-muted-foreground uppercase">
          Error · 404
        </p>
        <h1 className="font-heading text-4xl font-semibold tracking-tight">
          Not found.
        </h1>
        <p className="text-sm text-muted-foreground">
          The page you were looking for is missing or has been moved.
        </p>
      </div>
    </main>
  )
}

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body className="bg-background text-foreground antialiased">
        {children}
        {import.meta.env.DEV && (
          <TanStackDevtools
            config={{ position: "bottom-right" }}
            plugins={[
              { name: "Tanstack Router", render: <TanStackRouterDevtoolsPanel /> },
              { name: "React Query", render: <ReactQueryDevtoolsPanel /> },
              { name: "Agent", render: <AgentDevtoolsPanel appName="Stack Auth Dashboard V2" /> },
            ]}
          />
        )}
        <Scripts />
      </body>
    </html>
  )
}
