import { Link } from "@/components/link";
import type { IssueListItem, IssueOccurrence } from "./issues-data";
import { traceDetailHref } from "./issue-links";

export type IssueEventGraphNode = {
  id: "issue" | "occurrence" | "trace" | "replay" | "user" | "logs" | "release",
  label: string,
  detail: string,
  href: string | null,
  available: boolean,
};

type IssueEventGraphProps = {
  projectId: string,
  issue: Pick<IssueListItem, "short_id" | "release">,
  occurrence: Pick<IssueOccurrence, "occurrence_id" | "trace_id" | "session_replay_id" | "user_id"> | null,
  leadingUpToCount: number,
};

function shortIdentity(value: string | null): string {
  if (value == null || value === "") return "Not retained";
  return `${value.slice(0, 10)}…`;
}

/**
 * Builds the cross-signal spine from one retained occurrence. Keeping this
 * pure makes the graph deterministic in tests and, more importantly, means a
 * missing trace/replay/user never turns into a dead link or an invented
 * correlation. The graph is intentionally occurrence-scoped: an issue can
 * have many traces, but the selected occurrence has exactly one causal path.
 */
export function buildIssueEventGraphNodes(
  projectId: string,
  issue: Pick<IssueListItem, "short_id" | "release">,
  occurrence: Pick<IssueOccurrence, "occurrence_id" | "trace_id" | "session_replay_id" | "user_id"> | null,
  leadingUpToCount: number,
): IssueEventGraphNode[] {
  const trace = occurrence?.trace_id ?? null;
  const replay = occurrence?.session_replay_id ?? null;
  const user = occurrence?.user_id ?? null;
  const release = issue.release;
  return [
    {
      id: "issue",
      label: "Issue",
      detail: `#${issue.short_id}`,
      href: null,
      available: true,
    },
    {
      id: "occurrence",
      label: "Occurrence",
      detail: occurrence == null ? "No retained event" : shortIdentity(occurrence.occurrence_id),
      href: null,
      available: occurrence != null,
    },
    {
      id: "trace",
      label: "Trace",
      detail: shortIdentity(trace),
      href: trace == null ? null : traceDetailHref(projectId, trace),
      available: trace != null,
    },
    {
      id: "logs",
      label: "Logs",
      detail: leadingUpToCount > 0 ? `${leadingUpToCount} nearby` : "No nearby lines",
      href: leadingUpToCount > 0 ? `/projects/${encodeURIComponent(projectId)}/observability/logs` : null,
      available: leadingUpToCount > 0,
    },
    {
      id: "replay",
      label: "Replay",
      detail: replay == null ? "Not linked" : "Watch session",
      href: replay == null ? null : `/projects/${encodeURIComponent(projectId)}/session-replays/${encodeURIComponent(replay)}`,
      available: replay != null,
    },
    {
      id: "user",
      label: "User",
      detail: shortIdentity(user),
      href: user == null ? null : `/projects/${encodeURIComponent(projectId)}/users/${encodeURIComponent(user)}`,
      available: user != null,
    },
    {
      id: "release",
      label: "Release",
      detail: release == null ? "Not recorded" : release,
      href: null,
      available: release != null,
    },
  ];
}

function GraphNode({ node, index, total }: { node: IssueEventGraphNode, index: number, total: number }) {
  const content = (
    <span className="group relative flex min-w-[7.5rem] flex-1 flex-col items-center gap-1 text-center">
      <span
        aria-hidden="true"
        className={node.available
          ? "relative z-10 h-3 w-3 rounded-full border-2 border-background bg-foreground shadow-[0_0_0_3px_hsl(var(--foreground)/0.12)] transition-transform group-hover:scale-125"
          : "relative z-10 h-3 w-3 rounded-full border border-foreground/20 bg-background"}
      />
      <span className={node.available ? "text-[11px] font-medium text-foreground" : "text-[11px] text-muted-foreground/50"}>
        {node.label}
      </span>
      <span className="max-w-[8rem] truncate font-mono text-[10px] text-muted-foreground/70" title={node.detail}>
        {node.detail}
      </span>
      {node.href != null && <span className="text-[9px] uppercase tracking-[0.14em] text-muted-foreground/50">Open</span>}
    </span>
  );

  return (
    <>
      {node.href == null ? content : <Link href={node.href} className="flex flex-1 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-foreground/30">{content}</Link>}
      {index < total - 1 && <span aria-hidden="true" className="mt-1 h-px min-w-3 flex-1 bg-gradient-to-r from-foreground/20 to-foreground/10" />}
    </>
  );
}

export function IssueEventGraph({ projectId, issue, occurrence, leadingUpToCount }: IssueEventGraphProps) {
  const nodes = buildIssueEventGraphNodes(projectId, issue, occurrence, leadingUpToCount);
  return (
    <section aria-label="Error correlation graph" className="rounded-xl border border-foreground/[0.08] bg-gradient-to-br from-foreground/[0.045] via-background to-background px-3 py-4 sm:px-5">
      <div className="mb-4 flex items-end justify-between gap-3">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/70">Causal path</div>
          <h2 className="mt-1 text-sm font-medium text-foreground">From occurrence to context</h2>
        </div>
        <span className="hidden text-right text-[10px] leading-4 text-muted-foreground/60 sm:block">Only retained, authenticated links are shown</span>
      </div>
      <div className="overflow-x-auto pb-1">
        <div className="flex min-w-[48rem] items-start">
          {nodes.map((node, index) => <GraphNode key={node.id} node={node} index={index} total={nodes.length} />)}
        </div>
      </div>
      <div className="mt-4 flex items-center gap-2 text-[10px] text-muted-foreground/60 sm:hidden">
        <span className="h-1.5 w-1.5 rounded-full bg-foreground/60" />
        <span>Swipe horizontally to inspect linked signals.</span>
      </div>
    </section>
  );
}
