import { runAsynchronouslyWithAlert } from "@hexclave/shared/dist/utils/promises";
import { UserAvatar, useStackApp } from "@hexclave/tanstack-start";
import type { CurrentUser } from "@hexclave/tanstack-start";

type AuthDemoCardProps = {
  title: string,
  eyebrow: string,
  description: string,
  user: CurrentUser | null,
  code: string,
};

export function AuthDemoCard(props: AuthDemoCardProps) {
  const app = useStackApp();
  const userLabel = props.user?.displayName ?? props.user?.primaryEmail ?? props.user?.id;

  return (
    <section className="grid w-full gap-6">
      <div className="rounded-lg border border-zinc-200 bg-white p-8 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <p className="mb-2 text-sm font-medium text-zinc-500 dark:text-zinc-400">{props.eyebrow}</p>
        <h1 className="text-3xl font-semibold tracking-tight">{props.title}</h1>
        <p className="mt-4 max-w-2xl text-zinc-600 dark:text-zinc-300">{props.description}</p>

        <div className="mt-8 rounded-lg border border-zinc-200 p-5 dark:border-zinc-800">
          {props.user ? (
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
              <UserAvatar user={props.user} size={64} />
              <div className="min-w-0">
                <p className="text-sm text-zinc-500 dark:text-zinc-400">Resolved Hexclave user</p>
                <p className="truncate text-xl font-semibold">{userLabel}</p>
                <p className="mt-1 break-all font-mono text-sm text-zinc-500 dark:text-zinc-400">{props.user.id}</p>
              </div>
            </div>
          ) : (
            <div>
              <p className="text-lg font-semibold">No signed-in user</p>
              <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                This route rendered the signed-out branch from Hexclave.
              </p>
              <div className="mt-4 flex flex-wrap gap-3">
                <button className="rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white transition-colors hover:transition-none dark:bg-white dark:text-zinc-950" onClick={() => runAsynchronouslyWithAlert(app.redirectToSignIn())}>
                  Sign in
                </button>
                <button className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium transition-colors hover:bg-zinc-100 hover:transition-none dark:border-zinc-700 dark:hover:bg-zinc-800" onClick={() => runAsynchronouslyWithAlert(app.redirectToSignUp())}>
                  Sign up
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="rounded-lg border border-zinc-200 bg-zinc-950 p-5 text-zinc-100 shadow-sm dark:border-zinc-800">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold uppercase text-zinc-400">Usage snippet</h2>
        </div>
        <pre className="overflow-x-auto text-sm leading-6"><code>{props.code}</code></pre>
      </div>
    </section>
  );
}
