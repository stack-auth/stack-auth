import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export function getRouter() {
  return createRouter({
    routeTree,
    scrollRestoration: true,
    defaultNotFoundComponent: () => (
      <main className="grid min-h-screen place-items-center bg-zinc-100 px-4 text-zinc-950 dark:bg-zinc-950 dark:text-zinc-50">
        <div className="w-full max-w-md rounded-lg border border-zinc-200 bg-white p-8 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <p className="mb-2 text-sm font-medium text-zinc-500 dark:text-zinc-400">404</p>
          <h1 className="text-2xl font-semibold tracking-tight">Page not found</h1>
          <p className="mt-4 text-zinc-600 dark:text-zinc-300">This route is not part of the TanStack Start demo.</p>
        </div>
      </main>
    ),
  });
}
