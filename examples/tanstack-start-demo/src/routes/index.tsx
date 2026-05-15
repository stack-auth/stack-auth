import { runAsynchronouslyWithAlert } from "@stackframe/stack-shared/dist/utils/promises";
import { UserAvatar, useStackApp, useUser } from "@stackframe/tanstack-start";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  component: HomePage,
});

function HomePage() {
  const user = useUser({ includeRestricted: true });
  const app = useStackApp();

  if (!user) {
    return (
      <section className="grid w-full place-items-center">
        <div className="w-full max-w-xl rounded-lg border border-zinc-200 bg-white p-8 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <p className="mb-2 text-sm font-medium text-zinc-500 dark:text-zinc-400">TanStack Start alpha</p>
          <h1 className="text-3xl font-semibold tracking-tight">Welcome to the Stack demo app.</h1>
          <p className="mt-4 text-zinc-600 dark:text-zinc-300">
            This example uses <code className="rounded bg-zinc-100 px-1.5 py-0.5 text-sm dark:bg-zinc-800">@stackframe/tanstack-start</code> with file-based routes and Stack Auth handler pages.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <button className="rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white transition-colors hover:transition-none dark:bg-white dark:text-zinc-950" onClick={() => runAsynchronouslyWithAlert(app.redirectToSignIn())}>
              Sign in
            </button>
            <button className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium transition-colors hover:bg-zinc-100 hover:transition-none dark:border-zinc-700 dark:hover:bg-zinc-800" onClick={() => runAsynchronouslyWithAlert(app.redirectToSignUp())}>
              Sign up
            </button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="grid w-full place-items-center">
      <div className="w-full max-w-2xl rounded-lg border border-zinc-200 bg-white p-8 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
          <UserAvatar user={user} size={96} />
          <div className="min-w-0">
            <p className="text-sm text-zinc-500 dark:text-zinc-400">Signed in as</p>
            <h1 className="truncate text-3xl font-semibold tracking-tight">{user.displayName ?? user.primaryEmail ?? user.id}</h1>
            {user.isRestricted && (
              <span className="mt-2 inline-flex rounded bg-amber-100 px-2 py-1 text-sm font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
                Restricted
              </span>
            )}
          </div>
        </div>

        <dl className="mt-8 grid gap-3 text-sm">
          <div className="grid gap-1 sm:grid-cols-[8rem_1fr]">
            <dt className="font-medium text-zinc-500 dark:text-zinc-400">User ID</dt>
            <dd className="min-w-0 break-all font-mono">{user.id}</dd>
          </div>
          {user.primaryEmail && (
            <div className="grid gap-1 sm:grid-cols-[8rem_1fr]">
              <dt className="font-medium text-zinc-500 dark:text-zinc-400">Email</dt>
              <dd>{user.primaryEmail}</dd>
            </div>
          )}
          <div className="grid gap-1 sm:grid-cols-[8rem_1fr]">
            <dt className="font-medium text-zinc-500 dark:text-zinc-400">Restricted</dt>
            <dd>{user.isRestricted ? `Yes${user.restrictedReason ? ` (${user.restrictedReason.type})` : ""}` : "No"}</dd>
          </div>
        </dl>

        <div className="mt-8 flex flex-wrap gap-3">
          <button className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700 hover:transition-none" onClick={() => runAsynchronouslyWithAlert(app.redirectToSignOut())}>
            Sign out
          </button>
        </div>
      </div>
    </section>
  );
}
