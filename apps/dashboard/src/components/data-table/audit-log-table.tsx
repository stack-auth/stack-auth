"use client";

import { Link } from "@/components/link";
import { Badge } from "@/components/ui";
import {
  DataGrid,
  useDataGridUrlState,
  useDataSource,
  type DataGridColumnDef,
} from "@hexclave/dashboard-ui-components";
import { useMemo } from "react";

export type AuditLogAction =
  | "impersonation.started"
  | "impersonation.revoked"
  | "project_settings.updated";

export type AuditLogEvent = {
  id: string,
  created_at_millis: number,
  action: AuditLogAction,
  actor_type: "admin_user" | "server_key" | "unknown",
  actor_user_id: string | null,
  actor_label: string,
  target_user_id: string | null,
  reason: string | null,
  metadata: unknown,
};

type AuditFieldChange = {
  before: unknown,
  after: unknown,
};

type ParsedDetails =
  | { kind: "empty" }
  | { kind: "reason", reason: string }
  | {
    kind: "changes",
    paths: string[],
    changes: Record<string, AuditFieldChange> | null,
    truncated: boolean,
  };

function formatAction(action: AuditLogAction): string {
  switch (action) {
    case "impersonation.started": {
      return "Impersonation started";
    }
    case "impersonation.revoked": {
      return "Impersonation revoked";
    }
    case "project_settings.updated": {
      return "Project settings updated";
    }
    default: {
      const _exhaustive: never = action;
      return _exhaustive;
    }
  }
}

function formatAuditValue(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "boolean" || typeof value === "number") return String(value);
  return JSON.stringify(value);
}

function parseDetails(event: AuditLogEvent): ParsedDetails {
  if (event.reason != null && event.reason !== "") {
    return { kind: "reason", reason: event.reason };
  }
  if (
    event.metadata == null
    || typeof event.metadata !== "object"
    || Array.isArray(event.metadata)
  ) {
    return { kind: "empty" };
  }
  const metadata = event.metadata as {
    changed_paths?: unknown,
    changed_paths_truncated?: unknown,
    changes?: unknown,
  };
  const paths = metadata.changed_paths;
  if (!Array.isArray(paths) || !paths.every((path) => typeof path === "string")) {
    return { kind: "empty" };
  }
  const changes = metadata.changes != null
    && typeof metadata.changes === "object"
    && !Array.isArray(metadata.changes)
    ? metadata.changes as Record<string, AuditFieldChange>
    : null;
  return {
    kind: "changes",
    paths,
    changes,
    truncated: metadata.changed_paths_truncated === true,
  };
}

function formatDetails(event: AuditLogEvent): string {
  const parsed = parseDetails(event);
  switch (parsed.kind) {
    case "empty": {
      return "—";
    }
    case "reason": {
      return parsed.reason;
    }
    case "changes": {
      const parts = parsed.paths.map((path) => {
        const change = parsed.changes?.[path];
        if (change != null && "before" in change && "after" in change) {
          return `${path}: -${formatAuditValue(change.before)} +${formatAuditValue(change.after)}`;
        }
        return path;
      });
      const joined = parts.join(", ");
      return parsed.truncated ? `${joined}, …` : joined;
    }
    default: {
      const _exhaustive: never = parsed;
      return _exhaustive;
    }
  }
}

function AuditDetailsCell({ event }: { event: AuditLogEvent }) {
  const parsed = parseDetails(event);
  if (parsed.kind === "empty") {
    return <span className="text-muted-foreground">—</span>;
  }
  if (parsed.kind === "reason") {
    return (
      <span className="block truncate text-muted-foreground" title={parsed.reason}>
        {parsed.reason}
      </span>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-1.5 py-0.5">
      {parsed.paths.map((path) => {
        const change = parsed.changes?.[path];
        if (change == null || !("before" in change) || !("after" in change)) {
          return (
            <code key={path} className="truncate font-mono text-[11px] text-muted-foreground" title={path}>
              {path}
            </code>
          );
        }
        const before = formatAuditValue(change.before);
        const after = formatAuditValue(change.after);
        return (
          <div
            key={path}
            className="min-w-0 overflow-hidden rounded-md border border-border/60 bg-muted/20 font-mono text-[11px] leading-snug"
            title={`${path}\n- ${before}\n+ ${after}`}
          >
            <div className="truncate border-b border-border/50 px-1.5 py-0.5 text-[10px] text-muted-foreground">
              {path}
            </div>
            <div className="truncate bg-red-500/[0.08] px-1.5 py-0.5 text-red-700 dark:text-red-300">
              <span className="select-none text-red-500/70 dark:text-red-400/70">- </span>
              {before}
            </div>
            <div className="truncate bg-green-500/[0.08] px-1.5 py-0.5 text-green-800 dark:text-green-300">
              <span className="select-none text-green-600/70 dark:text-green-400/70">+ </span>
              {after}
            </div>
          </div>
        );
      })}
      {parsed.truncated ? (
        <span className="text-[11px] text-muted-foreground">…</span>
      ) : null}
    </div>
  );
}

function getColumns(projectId: string): DataGridColumnDef<AuditLogEvent>[] {
  return [
    {
      id: "createdAt",
      header: "When",
      accessor: (row) => new Date(row.created_at_millis),
      type: "dateTime",
      width: 180,
      renderCell: ({ row }) => (
        <span className="truncate">
          {new Date(row.created_at_millis).toLocaleString(undefined, {
            year: "numeric",
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
          })}
        </span>
      ),
    },
    {
      id: "action",
      header: "Action",
      accessor: (row) => formatAction(row.action),
      type: "string",
      width: 220,
      renderCell: ({ row }) => (
        <Badge variant="secondary">{formatAction(row.action)}</Badge>
      ),
    },
    {
      id: "actor",
      header: "Actor",
      accessor: "actor_label",
      type: "string",
      width: 180,
      flex: 1,
      renderCell: ({ row }) => (
        <span className="block truncate" title={row.actor_label}>{row.actor_label}</span>
      ),
    },
    {
      id: "target",
      header: "Target",
      accessor: (row) => row.target_user_id ?? "",
      type: "string",
      width: 200,
      // Absolute path required: relative `../users/...` from nested project pages
      // can drop the project id and 404.
      renderCell: ({ row }) => {
        if (row.target_user_id == null) {
          return <span className="text-muted-foreground">—</span>;
        }
        return (
          <Link
            href={`/projects/${encodeURIComponent(projectId)}/users/${encodeURIComponent(row.target_user_id)}`}
            className="block truncate underline underline-offset-2"
            title={row.target_user_id}
          >
            {row.target_user_id}
          </Link>
        );
      },
    },
    {
      id: "details",
      header: "Details",
      accessor: (row) => formatDetails(row),
      type: "string",
      width: 320,
      flex: 1.4,
      renderCell: ({ row }) => <AuditDetailsCell event={row} />,
    },
  ];
}

export function AuditLogTable(props: {
  events: AuditLogEvent[],
  projectId: string,
  isLoading?: boolean,
}) {
  const columns = useMemo(
    () => getColumns(props.projectId),
    [props.projectId],
  );

  const [gridState, setGridState] = useDataGridUrlState(columns, {
    paramPrefix: "auditlog",
    initial: { sorting: [{ columnId: "createdAt", direction: "desc" }] },
  });

  const gridData = useDataSource({
    data: props.events,
    columns,
    getRowId: (row) => row.id,
    sorting: gridState.sorting,
    quickSearch: gridState.quickSearch,
    pagination: gridState.pagination,
    paginationMode: "client",
  });

  return (
    <DataGrid
      columns={columns}
      rows={gridData.rows}
      getRowId={(row) => row.id}
      totalRowCount={gridData.totalRowCount}
      isLoading={props.isLoading === true || gridData.isLoading}
      state={gridState}
      onChange={setGridState}
      fillHeight={false}
      rowHeight="auto"
    />
  );
}
