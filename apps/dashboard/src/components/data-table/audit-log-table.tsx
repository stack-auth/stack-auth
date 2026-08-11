"use client";

import { Link } from "@/components/link";
import { Badge, Button, Popover, PopoverContent, PopoverTrigger } from "@/components/ui";
import { cn } from "@/lib/utils";
import {
  DataGrid,
  useDataGridUrlState,
  useDataSource,
  type DataGridColumnDef,
} from "@hexclave/dashboard-ui-components";
import { CaretDownIcon, CaretRightIcon, EyeSlashIcon } from "@phosphor-icons/react";
import { useMemo, useState } from "react";

export type AuditLogAction =
  | "impersonation.started"
  | "impersonation.revoked"
  | "project_settings.updated"
  | "user.created"
  | "user.deleted"
  | "user.updated"
  | "user.restricted"
  | "user.unrestricted"
  | "user.password.set"
  | "user.mfa.removed"
  | "user.password_reset.sent"
  | "user.sign_in_invitation.sent"
  | "contact_channel.created"
  | "contact_channel.updated"
  | "contact_channel.deleted"
  | "contact_channel.verification.sent"
  | "project_api_key.created"
  | "project_api_key.updated"
  | "project_api_key.revoked";

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
    case "user.created": {
      return "User created";
    }
    case "user.deleted": {
      return "User deleted";
    }
    case "user.updated": {
      return "User updated";
    }
    case "user.restricted": {
      return "User restricted";
    }
    case "user.unrestricted": {
      return "User unrestricted";
    }
    case "user.password.set": {
      return "User password set";
    }
    case "user.mfa.removed": {
      return "User MFA removed";
    }
    case "user.password_reset.sent": {
      return "Password reset email sent";
    }
    case "user.sign_in_invitation.sent": {
      return "Sign-in invitation sent";
    }
    case "contact_channel.created": {
      return "Contact channel created";
    }
    case "contact_channel.updated": {
      return "Contact channel updated";
    }
    case "contact_channel.deleted": {
      return "Contact channel deleted";
    }
    case "contact_channel.verification.sent": {
      return "Verification email sent";
    }
    case "project_api_key.created": {
      return "Project API key created";
    }
    case "project_api_key.updated": {
      return "Project API key updated";
    }
    case "project_api_key.revoked": {
      return "Project API key revoked";
    }
    default: {
      const _exhaustive: never = action;
      return _exhaustive;
    }
  }
}

const FIELD_LABELS = new Map<string, string>([
  ["primary_email", "Primary email"],
  ["primary_email_verified", "Email verified"],
  ["primary_email_auth_enabled", "Password sign-in"],
  ["display_name", "Display name"],
  ["password", "Password"],
  ["country_code", "Country"],
  ["signed_up_at_millis", "Signed up"],
  ["is_anonymous", "Anonymous"],
  ["client_metadata", "Client metadata"],
  ["client_read_only_metadata", "Client read-only metadata"],
  ["server_metadata", "Server metadata"],
  ["profile_image_url", "Profile image"],
  ["totp_secret_base64", "MFA secret"],
  ["restricted_by_admin", "Restricted by admin"],
  ["restricted_by_admin_reason", "Restriction reason"],
  ["risk_scores.sign_up.bot", "Sign-up bot risk"],
  ["risk_scores.sign_up.free_trial_abuse", "Free-trial abuse risk"],
  ["api_key_id", "API key ID"],
  ["description", "Description"],
  ["expires_at_millis", "Expires"],
  ["has_publishable_client_key", "Publishable client key"],
  ["has_secret_server_key", "Secret server key"],
  ["has_super_secret_admin_key", "Super secret admin key"],
]);

const OAUTH_PROVIDER_FIELD_LABELS = new Map<string, string>([
  ["type", "Type"],
  ["isShared", "Shared keys"],
  ["clientId", "Client ID"],
  ["clientSecret", "Client secret"],
  ["allowSignIn", "Sign-in"],
  ["allowConnectedAccounts", "Connected accounts"],
  ["customCallbackUrl", "Callback URL"],
  ["facebookConfigId", "Facebook config ID"],
  ["microsoftTenantId", "Microsoft tenant ID"],
  ["appleTeamId", "Apple team ID"],
  ["appleKeyId", "Apple key ID"],
  ["applePrivateKey", "Apple private key"],
  ["issuerUrl", "Issuer URL"],
  ["scope", "Scope"],
  ["displayName", "Display name"],
]);

function humanizeSegment(segment: string): string {
  return segment
    .split("_")
    .filter((part) => part.length > 0)
    .map((part) => {
      // Preserve camelCase boundaries: facebookConfigId → Facebook Config Id
      const withSpaces = part.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
      return withSpaces.charAt(0).toUpperCase() + withSpaces.slice(1);
    })
    .join(" ");
}

function humanizeProviderId(providerId: string): string {
  if (providerId === "github") return "GitHub";
  if (providerId === "linkedin") return "LinkedIn";
  if (providerId === "apple") return "Apple";
  if (providerId === "microsoft") return "Microsoft";
  if (providerId === "google") return "Google";
  if (providerId === "facebook") return "Facebook";
  if (providerId === "spotify") return "Spotify";
  if (providerId === "x") return "X";
  return humanizeSegment(providerId);
}

function humanizeFieldPath(path: string): string {
  const known = FIELD_LABELS.get(path);
  if (known != null) return known;

  // Auth Methods oauth provider paths are long and noisy when segment-joined;
  // collapse to "OAuth · Google · Client ID".
  const oauthMatch = /^auth\.oauth\.providers\.([^.]+)(?:\.(.+))?$/.exec(path);
  if (oauthMatch != null) {
    const providerLabel = humanizeProviderId(oauthMatch[1] ?? "");
    const fieldPath = oauthMatch[2];
    if (fieldPath == null || fieldPath === "") {
      return `OAuth · ${providerLabel}`;
    }
    const fieldLabel = OAUTH_PROVIDER_FIELD_LABELS.get(fieldPath)
      ?? fieldPath.split(".").map(humanizeSegment).join(" · ");
    return `OAuth · ${providerLabel} · ${fieldLabel}`;
  }

  return path.split(".").map(humanizeSegment).join(" · ");
}

function formatDisplayValue(value: unknown, path?: string): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") {
    if (path != null && path.endsWith("_millis")) {
      return new Date(value).toLocaleString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
    }
    return String(value);
  }
  if (typeof value === "string") return value;
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

function visibleChangePaths(parsed: Extract<ParsedDetails, { kind: "changes" }>): string[] {
  return parsed.paths.filter((path) => {
    const change = parsed.changes?.[path];
    if (change == null) return true;
    // Hide empty create noise (`null` → `null` / `""` from shared oauth field bags).
    if (change.before === null && (change.after === null || change.after === "")) return false;
    return true;
  });
}

function summarizeChanges(paths: string[], truncated: boolean): string {
  const count = paths.length;
  if (count === 0) return truncated ? "Changes…" : "No field details";
  // Keep the chip scannable: show a short field-name preview, then fall back to a count.
  const previewLimit = 3;
  const labels = paths.slice(0, previewLimit).map(humanizeFieldPath);
  const preview = labels.join(" · ");
  if (count <= previewLimit && !truncated) return preview;
  return `${preview} · +${count - previewLimit}${truncated ? "…" : ""}`;
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
      return summarizeChanges(visibleChangePaths(parsed), parsed.truncated);
    }
    default: {
      const _exhaustive: never = parsed;
      return _exhaustive;
    }
  }
}

function AuditFieldRow({
  path,
  change,
}: {
  path: string,
  change: AuditFieldChange | null | undefined,
}) {
  const label = humanizeFieldPath(path);

  if (change == null || !("before" in change) || !("after" in change)) {
    return (
      <div className="flex items-center justify-between gap-3 py-2">
        <span className="text-xs text-muted-foreground">{label}</span>
        <Badge variant="secondary" className="gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium">
          <EyeSlashIcon className="size-3" />
          Hidden
        </Badge>
      </div>
    );
  }

  if (change.before === null) {
    const after = formatDisplayValue(change.after, path);
    return (
      <div className="flex items-start justify-between gap-3 py-2">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className="max-w-[60%] truncate text-right text-xs font-medium text-foreground" title={after}>
          {after}
        </span>
      </div>
    );
  }

  if (change.after === null) {
    return (
      <div className="flex flex-col gap-1 py-2">
        <span className="text-xs text-muted-foreground">{label}</span>
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="rounded-md bg-red-500/[0.08] px-1.5 py-0.5 text-red-700 line-through decoration-red-700/40 dark:text-red-300 dark:decoration-red-300/40">
            {formatDisplayValue(change.before, path)}
          </span>
          <span className="text-muted-foreground" aria-hidden>→</span>
          <span className="rounded-md bg-red-500/[0.1] px-1.5 py-0.5 font-medium text-red-700 dark:text-red-300">
            Removed
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1 py-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <span className="rounded-md bg-red-500/[0.08] px-1.5 py-0.5 text-red-700 line-through decoration-red-700/40 dark:text-red-300 dark:decoration-red-300/40">
          {formatDisplayValue(change.before, path)}
        </span>
        <span className="text-muted-foreground" aria-hidden>→</span>
        <span className="rounded-md bg-emerald-500/[0.1] px-1.5 py-0.5 font-medium text-emerald-800 dark:text-emerald-300">
          {formatDisplayValue(change.after, path)}
        </span>
      </div>
    </div>
  );
}

/** Same glass surface as user-table filter popovers / design controls. */
const auditDetailsPopoverClassName = cn(
  "w-[min(22rem,calc(100vw-2rem))] rounded-xl border-black/[0.08] bg-white/95 p-0 shadow-md",
  "ring-1 ring-black/[0.08] backdrop-blur-xl",
  "dark:border-white/[0.06] dark:bg-background/95 dark:ring-white/[0.06]",
);

function AuditDetailsCell({ event }: { event: AuditLogEvent }) {
  const [open, setOpen] = useState(false);
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

  const paths = visibleChangePaths(parsed);
  const summary = summarizeChanges(paths, parsed.truncated);
  const actionLabel = formatAction(event.action);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn(
            "h-8 max-w-full justify-start gap-1.5 rounded-xl border-black/[0.08] bg-white/85 px-3 text-xs shadow-sm ring-1 ring-black/[0.08] hover:bg-white hover:transition-none dark:border-white/[0.06] dark:bg-foreground/[0.03] dark:ring-white/[0.06] dark:hover:bg-foreground/[0.06]",
            open && "bg-white ring-black/[0.14] dark:bg-foreground/[0.08] dark:ring-white/[0.14]",
          )}
          aria-expanded={open}
          aria-label={`${open ? "Hide" : "Show"} details: ${summary}`}
        >
          {open ? (
            <CaretDownIcon className="size-3.5 shrink-0 text-muted-foreground" weight="bold" />
          ) : (
            <CaretRightIcon className="size-3.5 shrink-0 text-muted-foreground" weight="bold" />
          )}
          <span className="truncate font-medium text-foreground/80">{summary}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="bottom"
        sideOffset={8}
        className={auditDetailsPopoverClassName}
      >
        <div className="border-b border-black/[0.06] px-3 py-2.5 dark:border-white/[0.06]">
          <div className="text-sm font-medium text-foreground">{actionLabel}</div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {paths.length} {paths.length === 1 ? "field" : "fields"}
            {parsed.truncated ? " · list truncated" : ""}
          </p>
        </div>
        <div className="max-h-64 divide-y divide-border/40 overflow-y-auto px-3">
          {paths.map((path) => (
            <AuditFieldRow key={path} path={path} change={parsed.changes?.[path]} />
          ))}
        </div>
      </PopoverContent>
    </Popover>
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
      width: 220,
      flex: 1.2,
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
    />
  );
}
