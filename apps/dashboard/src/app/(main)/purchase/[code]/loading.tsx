export default function Loading() {
  return (
    <div data-hexclave-purchase-page className="relative min-h-screen bg-white dark:bg-zinc-950">
      <div className="relative flex min-h-screen w-full flex-col lg:flex-row">
        <div className="flex flex-1 flex-col border-b border-border/40 bg-white dark:bg-zinc-950 lg:w-1/2 lg:border-b-0 lg:border-r">
          <div className="mx-auto w-full max-w-md px-6 pb-12 pt-16 lg:pt-20">
            <div className="space-y-5">
              <div className="size-12 animate-pulse rounded-full bg-foreground/10" />
              <div className="h-10 w-2/3 animate-pulse rounded-lg bg-foreground/10" />
              <div className="h-5 w-full animate-pulse rounded-md bg-foreground/10" />
              <div className="mt-8 h-20 w-full animate-pulse rounded-xl bg-foreground/10" />
              <div className="h-24 w-full animate-pulse rounded-xl bg-foreground/10" />
            </div>
          </div>
        </div>

        <div className="flex flex-1 flex-col justify-center bg-zinc-200 dark:bg-black lg:w-1/2">
          <div className="mx-auto w-full max-w-md px-6 py-12">
            <div className="h-64 w-full animate-pulse rounded-2xl bg-background/70 dark:bg-white/10" />
          </div>
        </div>
      </div>
    </div>
  );
}
