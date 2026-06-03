"use client";

export function WrongAddressScreen(props: { suggestedUrl: string }) {
  return (
    <div className="relative z-10 min-h-screen bg-background text-foreground flex items-center justify-center px-4">
      <div className="w-full max-w-lg rounded-2xl border border-black/[0.10] dark:border-white/[0.10] bg-white dark:bg-background p-6 shadow-sm">
        <div className="mb-3 inline-flex rounded-full bg-amber-500/10 px-3 py-1 text-xs font-medium text-amber-700 dark:text-amber-300">
          Wrong address
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">Use a different address to access this page</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          {"You're accessing the development environment using an address that isn't supported (such as "}
          <code className="rounded bg-black/[0.04] dark:bg-white/[0.06] px-1 py-0.5 text-xs">localhost</code>
          {")."}
        </p>
        <p className="mt-4 text-sm leading-6 text-muted-foreground">
          Please open this link instead:
        </p>
        <a
          href={props.suggestedUrl}
          className="mt-3 block overflow-x-auto rounded-lg bg-black/[0.04] dark:bg-white/[0.06] px-3 py-2 text-sm font-medium text-blue-700 dark:text-blue-300 hover:underline"
        >
          {props.suggestedUrl}
        </a>
      </div>
    </div>
  );
}
