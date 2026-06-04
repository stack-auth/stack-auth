"use client";

import { useAdminApp } from "@/app/(main)/(protected)/projects/[projectId]/use-admin-app";
import {
  ActionCell,
  ActionDialog,
  Avatar,
  AvatarFallback,
  AvatarImage,
  Badge,
  Button,
  SimpleTooltip,
  toast,
} from "@/components/ui";
import { ServerTeam, ServerUser } from "@hexclave/next";
import { fromNow } from "@hexclave/shared/dist/utils/dates";
import { captureError } from "@hexclave/shared/dist/utils/errors";
import { runAsynchronously, runAsynchronouslyWithAlert } from "@hexclave/shared/dist/utils/promises";
import {
  DataGrid,
  useDataGridUrlState,
  useDataSource,
  type DataGridColumnDef,
  type DataGridDataSource,
} from "@hexclave/dashboard-ui-components";
import { CheckCircleIcon, CopyIcon, XCircleIcon } from "@phosphor-icons/react";
import { useCallback, useMemo, useRef, useState } from "react";
import { useDebounce } from "use-debounce";
import * as yup from "yup";
import { Link } from "../link";
import { SmartFormDialog } from "../form-dialog";
import { PermissionListField } from "../permission-field";
import { extendUsers, type ExtendedServerUser } from "./user-table";

const PAGE_SIZE = 25;
const SEARCH_DEBOUNCE_MS = 300;

type ExtendedServerUserForTeam = ExtendedServerUser & {
  // `null` indicates that the permission fetch failed for this user; the UI
  // surfaces this distinctly from an empty (no permissions) array so admins
  // don't mistake transient failures for revoked access.
  permissions: string[] | null,
};

function formatUserId(id: string) {
  if (id.length <= 10) {
    return id;
  }
  return `${id.slice(0, 6)}…${id.slice(-4)}`;
}

function getDateMeta(value: Date | string | null | undefined, emptyLabel: string) {
  if (!value) {
    return { label: emptyLabel };
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return { label: emptyLabel };
  }
  return {
    label: fromNow(date),
    tooltip: date.toString(),
  };
}

function TeamMemberUserCell(props: { user: ExtendedServerUserForTeam }) {
  const { user } = props;
  const hexclaveAdminApp = useAdminApp();
  const profileUrl = `/projects/${encodeURIComponent(hexclaveAdminApp.projectId)}/users/${encodeURIComponent(user.id)}`;
  const fallback = user.displayName?.charAt(0) ?? user.primaryEmail?.charAt(0) ?? "?";
  const displayName = user.displayName ?? user.primaryEmail ?? "Unnamed user";

  return (
    <div className="flex items-center gap-3">
      <Link href={profileUrl} className="rounded-full">
        <Avatar className="h-6 w-6">
          <AvatarImage src={user.profileImageUrl ?? undefined} alt={user.displayName ?? user.primaryEmail ?? "User avatar"} />
          <AvatarFallback>{fallback}</AvatarFallback>
        </Avatar>
      </Link>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={profileUrl}
            className="max-w-full text-sm font-semibold text-foreground hover:text-foreground"
          >
            <span className="block truncate" title={displayName}>
              {displayName}
            </span>
          </Link>
        </div>
      </div>
    </div>
  );
}

function TeamMemberEmailCell(props: { user: ExtendedServerUserForTeam }) {
  const { user } = props;
  const email = user.primaryEmail ?? "No email";

  return (
    <span className="block max-w-full truncate text-sm text-muted-foreground" title={user.primaryEmail ?? undefined}>
      {email}
    </span>
  );
}

function TeamMemberUserIdCell(props: { user: ExtendedServerUserForTeam }) {
  const { user } = props;
  const idLabel = formatUserId(user.id);

  const handleCopy = () => {
    runAsynchronouslyWithAlert(async () => {
      await navigator.clipboard.writeText(user.id);
      toast({ title: "Copied to clipboard", variant: "success" });
    });
  };

  return (
    <SimpleTooltip tooltip="Copy user ID">
      <Button
        type="button"
        onClick={handleCopy}
        className="flex max-w-full px-1 py-0 h-min items-center gap-2 font-mono text-xs text-muted-foreground transition hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring cursor-pointer bg-transparent hover:bg-transparent"
        aria-label="Copy user ID"
        title={user.id}
      >
        <span className="truncate">{idLabel}</span>
        <CopyIcon className="h-3 w-3" />
      </Button>
    </SimpleTooltip>
  );
}

function TeamMemberEmailStatusCell(props: { user: ExtendedServerUserForTeam }) {
  const { user } = props;
  const isVerified = user.emailVerified === "verified";
  return (
    <div className="flex items-center justify-start">
      {isVerified ? (
        <CheckCircleIcon className="h-4 w-4 text-success" aria-label="Email verified" />
      ) : (
        <XCircleIcon className="h-4 w-4 text-amber-500" aria-label="Email unverified" />
      )}
    </div>
  );
}

function TeamMemberLastActiveCell(props: { user: ExtendedServerUserForTeam }) {
  const { user } = props;
  const meta = getDateMeta(user.lastActiveAt, "Never");
  return (
    <span className="text-sm text-muted-foreground whitespace-nowrap" title={meta.tooltip}>
      {meta.label}
    </span>
  );
}

function RemoveUserDialog(props: {
  team: ServerTeam,
  user: ServerUser,
  open: boolean,
  onOpenChange: (open: boolean) => void,
}) {
  return <ActionDialog
    title
    danger
    open={props.open}
    onOpenChange={props.onOpenChange}
    okButton={{
      label: "Remove user from team",
      onClick: async () => { runAsynchronouslyWithAlert(() => props.team.removeUser(props.user.id)); }
    }}
    cancelButton
    confirmText="I understand this will cause the user to lose access to the team."
  >
    {`Are you sure you want to remove the user "${props.user.displayName}" from the team "${props.team.displayName}"?`}
  </ActionDialog>;
}

function EditPermissionDialog(props: {
  user: ExtendedServerUserForTeam,
  team: ServerTeam,
  open: boolean,
  onOpenChange: (open: boolean) => void,
  onSubmit: () => void,
}) {
  const hexclaveAdminApp = useAdminApp();
  const permissions = hexclaveAdminApp.useTeamPermissionDefinitions();

  const currentPermissions = props.user.permissions ?? [];
  const formSchema = yup.object({
    permissions: yup.array().of(yup.string().defined()).defined().meta({
      stackFormFieldRender: (innerProps) => (
        <PermissionListField
          {...innerProps}
          permissions={permissions}
          type="edit-user"
          containedPermissionIds={currentPermissions}
        />
      ),
    }),
  }).default({ permissions: currentPermissions });

  return <SmartFormDialog
    open={props.open}
    onOpenChange={props.onOpenChange}
    title="Edit Permission"
    formSchema={formSchema}
    okButton={{ label: "Save" }}
    onSubmit={async (values) => {
      const promises = permissions.map(async (p) => {
        if (values.permissions.includes(p.id)) {
          return await props.user.grantPermission(props.team, p.id);
        } else if (currentPermissions.includes(p.id)) {
          return await props.user.revokePermission(props.team, p.id);
        }
      });
      await Promise.all(promises);
      props.onSubmit();
    }}
    cancelButton
  />;
}


function Actions(props: {
  user: ExtendedServerUserForTeam,
  team: ServerTeam,
  setUpdateCounter: (c: (v: number) => number) => void,
}) {
  const [isRemoveModalOpen, setIsRemoveModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);

  return (
    <>
      <RemoveUserDialog
        user={props.user}
        team={props.team}
        open={isRemoveModalOpen}
        onOpenChange={setIsRemoveModalOpen}
      />
      <EditPermissionDialog
        user={props.user}
        team={props.team}
        open={isEditModalOpen}
        onOpenChange={setIsEditModalOpen}
        onSubmit={() => props.setUpdateCounter(c => c + 1)}
      />
      <ActionCell
        items={[
          {
            item: "Edit permissions",
            onClick: () => setIsEditModalOpen(true),
            disabled: props.user.permissions == null,
            disabledTooltip: "Permissions failed to load for this user. Reload the table to retry.",
          },
          '-',
          {
            item: "Remove from team",
            danger: true,
            onClick: () => setIsRemoveModalOpen(true),
          }
        ]}
      />
    </>
  );
}

const PERMISSION_FETCH_TIMEOUT_MS = 10_000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

export function TeamMemberTable(props: { team: ServerTeam }) {
  const hexclaveAdminApp = useAdminApp();
  const [updateCounter, setUpdateCounter] = useState(0);
  const [permissions, setPermissions] = useState<Map<string, string[] | null>>(new Map());
  const permissionRequestIdRef = useRef(0);

  const teamMemberColumns = useMemo<DataGridColumnDef<ExtendedServerUserForTeam>[]>(() => [
    {
      id: "user",
      header: "User",
      width: 200,
      flex: 1,
      sortable: false,
      type: "custom",
      renderCell: ({ row }) => <TeamMemberUserCell user={row} />,
    },
    {
      id: "email",
      header: "Email",
      accessor: (row) => row.primaryEmail ?? "",
      width: 200,
      flex: 1,
      sortable: false,
      type: "string",
      renderCell: ({ row }) => <TeamMemberEmailCell user={row} />,
    },
    {
      id: "userId",
      header: "User ID",
      width: 140,
      sortable: false,
      type: "custom",
      renderCell: ({ row }) => <TeamMemberUserIdCell user={row} />,
    },
    {
      id: "emailStatus",
      header: "Email Verified",
      width: 130,
      sortable: false,
      type: "custom",
      renderCell: ({ row }) => <TeamMemberEmailStatusCell user={row} />,
    },
    {
      id: "lastActiveAt",
      header: "Last active",
      accessor: (row) => row.lastActiveAt,
      width: 120,
      sortable: true,
      type: "custom",
      renderCell: ({ row }) => <TeamMemberLastActiveCell user={row} />,
    },
    {
      id: "permissions",
      header: () => (
        <div className="flex items-center gap-1">
          Permissions
          <SimpleTooltip tooltip="Only showing direct permissions" type='info' />
        </div>
      ),
      accessor: (row) => row.permissions == null ? "" : row.permissions.join(", "),
      width: 180,
      flex: 1,
      sortable: false,
      type: "string",
      cellOverflow: "wrap",
      renderCell: ({ row }) => (
        row.permissions == null ? (
          <SimpleTooltip tooltip="Failed to load permissions for this user. Reload the table to retry.">
            <span className="text-xs text-destructive">Failed to load</span>
          </SimpleTooltip>
        ) : (
          <div className="flex items-center gap-1 flex-wrap">
            {row.permissions.map((permissionId) => (
              <Badge key={permissionId} variant="secondary">{permissionId}</Badge>
            ))}
          </div>
        )
      ),
    },
    {
      id: "actions",
      header: "",
      sortable: false,
      hideable: false,
      resizable: false,
      width: 56,
      minWidth: 56,
      maxWidth: 56,
      align: "right",
      type: "custom",
      renderCell: ({ row }) => (
        <Actions user={row} team={props.team} setUpdateCounter={setUpdateCounter} />
      ),
    },
  ], [props.team]);

  const [gridState, setGridState] = useDataGridUrlState(teamMemberColumns, {
    paramPrefix: "members",
    initial: {
      sorting: [{ columnId: "lastActiveAt", direction: "desc" }],
      columnVisibility: { emailStatus: false },
    },
  });

  const [debouncedQuickSearch] = useDebounce(gridState.quickSearch.trim(), SEARCH_DEBOUNCE_MS);

  const dataSource = useMemo<DataGridDataSource<ExtendedServerUserForTeam>>(
    () => async function* (params) {
      const reqId = ++permissionRequestIdRef.current;
      const activeSort = params.sorting.find((s) => s.columnId === "lastActiveAt");
      const sortDesc = activeSort?.direction !== "asc";
      const cursor = typeof params.cursor === "string" ? params.cursor : undefined;
      const search = typeof params.quickSearch === "string" && params.quickSearch.trim().length > 0
        ? params.quickSearch.trim()
        : undefined;
      // Fan the user-list page and the team-wide permissions bulk-fetch
      // out in parallel — they're independent and the bulk fetch is
      // cached across pages of the same team.
      const [result, permsResult] = await Promise.allSettled([
        hexclaveAdminApp.listUsers({
          limit: PAGE_SIZE,
          teamId: props.team.id,
          orderBy: "lastActiveAt",
          desc: sortDesc,
          cursor,
          query: search,
          includeAnonymous: true,
          includeRestricted: true,
        }),
        withTimeout(
          hexclaveAdminApp.listTeamMemberPermissions(props.team.id, { recursive: false }),
          PERMISSION_FETCH_TIMEOUT_MS,
          `listTeamMemberPermissions(${props.team.id})`,
        ),
      ]);
      if (result.status === "rejected") throw result.reason;
      const extended = extendUsers(result.value);
      let permsByUser: Map<string, string[]> | null = null;
      if (permsResult.status === "fulfilled") {
        permsByUser = new Map();
        for (const { userId, permissionId } of permsResult.value) {
          const existing = permsByUser.get(userId);
          if (existing) existing.push(permissionId);
          else permsByUser.set(userId, [permissionId]);
        }
      } else {
        captureError(
          "team-member-table-list-permissions",
          permsResult.reason instanceof Error ? permsResult.reason : new Error(String(permsResult.reason)),
        );
      }
      if (reqId !== permissionRequestIdRef.current) return;
      const resolved = extended.map((user): readonly [string, string[] | null] =>
        [user.id, permsByUser ? (permsByUser.get(user.id) ?? []) : null] as const,
      );
      setPermissions((prev) => {
        const next = new Map(prev);
        for (const [id, perms] of resolved) next.set(id, perms);
        return next;
      });
      const permsMap = new Map(resolved);
      yield {
        rows: extended.map((user) => ({
          ...user,
          permissions: permsMap.has(user.id) ? permsMap.get(user.id) ?? null : null,
        })),
        hasMore: result.value.nextCursor != null,
        nextCursor: result.value.nextCursor ?? undefined,
      };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- updateCounter forces refetch after permission edits
    [hexclaveAdminApp, props.team, updateCounter],
  );

  const getRowId = useCallback((row: ExtendedServerUserForTeam) => row.id, []);

  const gridData = useDataSource({
    dataSource,
    columns: teamMemberColumns,
    getRowId,
    sorting: gridState.sorting,
    quickSearch: debouncedQuickSearch,
    pagination: gridState.pagination,
    paginationMode: "infinite",
  });

  const rowsWithPermissions = useMemo(
    () => gridData.rows.map((row) => ({
      ...row,
      permissions: permissions.has(row.id) ? permissions.get(row.id) ?? null : row.permissions,
    })),
    [gridData.rows, permissions],
  );

  return (
    <DataGrid
      columns={teamMemberColumns}
      rows={rowsWithPermissions}
      getRowId={getRowId}
      isLoading={gridData.isLoading}
      isRefetching={gridData.isRefetching}
      state={gridState}
      onChange={setGridState}
      paginationMode="infinite"
      hasMore={gridData.hasMore}
      isLoadingMore={gridData.isLoadingMore}
      onLoadMore={gridData.loadMore}
      rowHeight="auto"
      estimatedRowHeight={44}
      footer={false}
      fillHeight={false}
    />
  );
}
