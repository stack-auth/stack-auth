/// <reference types="vite/client" />
import "../styles.css";

import { StackProvider, StackTheme } from "@stackframe/tanstack-start";
import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { Suspense, useMemo } from "react";
import { Header } from "~/components/header";
import { createStackApp } from "~/stack";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Stack Auth TanStack Start Demo" },
      {
        name: "description",
        content: "TanStack Start demo application using Stack Auth.",
      },
    ],
  }),
  shellComponent: RootDocument,
  component: RootComponent,
});

function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const stackApp = useMemo(() => createStackApp(), []);

  return (
    <StackProvider app={stackApp}>
      <StackTheme>
        <div className="min-h-screen bg-zinc-100 text-zinc-950 dark:bg-zinc-950 dark:text-zinc-50">
          <Header />
          <main className="mx-auto flex min-h-[calc(100vh-3.5rem)] max-w-5xl px-4 py-8">
            <Suspense fallback={null}>
              <Outlet />
            </Suspense>
          </main>
        </div>
      </StackTheme>
    </StackProvider>
  );
}
