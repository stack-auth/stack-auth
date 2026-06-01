import { useUser } from "@hexclave/tanstack-start";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/protected")({
  ssr: false,
  component: ProtectedPage,
});

function ProtectedPage() {
  const user = useUser({ or: "redirect" });

  return (
    <section className="grid w-full place-items-center">
      <div className="w-full max-w-xl rounded-lg border border-zinc-200 bg-white p-8 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <p className="mb-2 text-sm font-medium text-green-600 dark:text-green-400">Protected route</p>
        <h1 className="text-2xl font-semibold tracking-tight">You can see this because you are signed in.</h1>
        <p className="mt-4 text-zinc-600 dark:text-zinc-300">
          TanStack Start rendered this route with Hexclave session state for <span className="font-medium text-zinc-950 dark:text-zinc-50">{user.displayName ?? user.primaryEmail ?? user.id}</span>.
        </p>
      </div>
    </section>
  );
}
