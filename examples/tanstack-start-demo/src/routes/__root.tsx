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
      { title: "Hexclave TanStack Start Demo" },
      {
        name: "description",
        content: "TanStack Start demo application using Hexclave.",
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
        <AppShell>
          <Suspense fallback={<RouteLoadingState />}>
            <Outlet />
          </Suspense>
        </AppShell>
      </StackTheme>
    </StackProvider>
  );
}

function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-zinc-100 text-zinc-950 dark:bg-zinc-950 dark:text-zinc-50">
      <Header />
      <main className="mx-auto flex min-h-[calc(100vh-3.5rem)] max-w-5xl px-4 py-8">
        {children}
      </main>
    </div>
  );
}

function RouteLoadingState() {
  return (
    <section className="grid w-full place-items-center">
      <div className="w-full max-w-2xl rounded-lg border border-zinc-200 bg-white p-8 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
          <div className="h-24 w-24 shrink-0 rounded-full bg-zinc-200 dark:bg-zinc-800" />
          <div className="min-w-0 flex-1">
            <div className="h-4 w-24 rounded bg-zinc-200 dark:bg-zinc-800" />
            <div className="mt-3 h-9 w-full max-w-md rounded bg-zinc-200 dark:bg-zinc-800" />
          </div>
        </div>
        <div className="mt-8 grid gap-3 text-sm">
          <div className="grid gap-1 sm:grid-cols-[8rem_1fr]">
            <div className="h-5 w-16 rounded bg-zinc-200 dark:bg-zinc-800" />
            <div className="h-5 w-full rounded bg-zinc-200 dark:bg-zinc-800" />
          </div>
          <div className="grid gap-1 sm:grid-cols-[8rem_1fr]">
            <div className="h-5 w-20 rounded bg-zinc-200 dark:bg-zinc-800" />
            <div className="h-5 w-12 rounded bg-zinc-200 dark:bg-zinc-800" />
          </div>
        </div>
        <div className="mt-8 h-9 w-20 rounded-md bg-zinc-200 dark:bg-zinc-800" />
      </div>
    </section>
  );
}
