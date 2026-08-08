import { PageLayout } from "../page-layout";

export default function Loading() {
  return (
    <PageLayout title="OAuth Provider" description="Configure project-scoped OAuth, OIDC, and MCP access.">
      <div className="rounded-2xl border border-black/[0.08] bg-white/80 p-6 shadow-sm dark:border-white/[0.12] dark:bg-white/[0.04]">
        <p className="font-semibold">Loading OAuth Provider settings…</p>
        <p className="mt-2 text-sm text-muted-foreground">Fetching the project configuration.</p>
        <div className="mt-5 h-24 animate-pulse rounded-xl bg-black/[0.06] dark:bg-white/[0.08]" />
      </div>
    </PageLayout>
  );
}
