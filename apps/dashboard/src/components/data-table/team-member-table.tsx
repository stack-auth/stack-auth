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
import { Link } from "../link";
import { ServerTeam, ServerUser } from "@stackframe/stack";
import { fromNow } from "@stackframe/stack-shared/dist/utils/dates";
import { runAsynchronously, runAsynchronouslyWithAlert } from "@stackframe/stack-shared/dist/utils/promises";
import {
  createDefaultDataGridState,
  DataGrid,
  useDataSource,
  type DataGridColumnDef,
  type DataGridState,
} from "@stackframe/dashboard-ui-components";
import { CheckCircleIcon, CopyIcon, XCircleIcon } from "@phosphor-icons/react";
import { useEffect, useMemo, useState } from "react";
import * as yup from "yup";
import { SmartFormDialog } from "../form-dialog";
import { PermissionListField } from "../permission-field";
import { extendUsers, type ExtendedServerUser } from "./user-table";

type ExtendedServerUserForTeam = ExtendedServerUser & {
  permissions: string[],
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
  const stackAdminApp = useAdminApp();
  const profileUrl = `/projects/${encodeURIComponent(stackAdminApp.projectId)}/users/${encodeURIComponent(user.id)}`;
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
          {user.isAnonymous && (
            <Badge variant="secondary" className="text-xs">
              Anonymous
            </Badge>
          )}
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
      onClick: async () => { await props.team.removeUser(props.user.id); }
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
  const stackAdminApp = useAdminApp();
  const permissions = stackAdminApp.useTeamPermissionDefinitions();

  const formSchema = yup.object({
    permissions: yup.array().of(yup.string().defined()).defined().meta({
      stackFormFieldRender: (innerProps) => (
        <PermissionListField
          {...innerProps}
          permissions={permissions}
          type="edit-user"
          containedPermissionIds={props.user.permissions}
        />
      ),
    }),
  }).default({ permissions: props.user.permissions });

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
        } else if (props.user.permissions.includes(p.id)) {
          return await props.user.revokePermission(props.team, p.id);
        }
      });
      await Promise.allSettled(promises);
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

export function TeamMemberTable(props: { users: ServerUser[], team: ServerTeam }) {
  const [updateCounter, setUpdateCounter] = useState(0);

  const teamMemberColumns = useMemo<DataGridColumnDef<ExtendedServerUserForTeam>[]>(() => [
    {
      id: "user",
      header: "User",
      width: 160,
      flex: 1,
      minWidth: 110,
      maxWidth: 220,
      sortable: false,
      type: "custom",
      renderCell: ({ row }) => <TeamMemberUserCell user={row} />,
    },
    {
      id: "email",
      header: "Email",
      accessor: (row) => row.primaryEmail ?? "",
      width: 160,
      flex: 1,
      minWidth: 110,
      maxWidth: 220,
      sortable: false,
      type: "string",
      renderCell: ({ row }) => <TeamMemberEmailCell user={row} />,
    },
    {
      id: "userId",
      header: "User ID",
      width: 130,
      minWidth: 90,
      maxWidth: 160,
      sortable: false,
      type: "custom",
      renderCell: ({ row }) => <TeamMemberUserIdCell user={row} />,
    },
    {
      id: "emailStatus",
      header: "Email Verified",
      width: 110,
      minWidth: 80,
      maxWidth: 130,
      sortable: false,
      type: "custom",
      renderCell: ({ row }) => <TeamMemberEmailStatusCell user={row} />,
    },
    {
      id: "lastActiveAt",
      header: "Last active",
      accessor: (row) => row.lastActiveAt,
      width: 110,
      minWidth: 80,
      maxWidth: 130,
      sortable: false,
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
      accessor: (row) => row.permissions.join(", "),
      width: 120,
      minWidth: 80,
      sortable: false,
      type: "string",
      cellOverflow: "wrap",
      renderCell: ({ row }) => (
        <div className="flex items-center gap-1 flex-wrap">
          {row.permissions.map((permissionId) => (
            <Badge key={permissionId} variant="secondary">{permissionId}</Badge>
          ))}
        </div>
      ),
    },
    {
      id: "actions",
      header: "",
      sortable: false,
      hideable: false,
      resizable: false,
      width: 48,
      type: "custom",
      renderCell: ({ row }) => (
        <Actions user={row} team={props.team} setUpdateCounter={setUpdateCounter} />
      ),
    },
  ], [props.team]);

  const [gridState, setGridState] = useState<DataGridState>(() => {
    const base = createDefaultDataGridState(teamMemberColumns);
    return {
      ...base,
      columnVisibility: {
        ...base.columnVisibility,
        emailStatus: false,
      },
    };
  });

  const [users, setUsers] = useState<ServerUser[]>([]);
  const [userPermissions, setUserPermissions] = useState<Map<string, string[]>>(new Map());
  const [isLoadingExtendedUsers, setIsLoadingExtendedUsers] = useState(true);

  const extendedUsers: ExtendedServerUserForTeam[] = useMemo(() => {
    return extendUsers(users).map((user) => ({
      ...user,
      permissions: userPermissions.get(user.id) ?? [],
    }));
  }, [users, userPermissions]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const promises = props.users.map(async user => {
        const permissions = await user.listPermissions(props.team, { recursive: false });
        return {
          user,
          permissions,
        };
      });
      return await Promise.all(promises);
    }

    setIsLoadingExtendedUsers(true);
    runAsynchronously(load().then((data) => {
      if (cancelled) return;
      setUserPermissions(new Map(
        props.users.map((user, index) => [user.id, data[index].permissions.map(p => p.id)])
      ));
      setUsers(data.map(d => d.user));
      setIsLoadingExtendedUsers(false);
    }).catch(() => {
      if (cancelled) return;
      setIsLoadingExtendedUsers(false);
    }));
    return () => {
      cancelled = true;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.users, props.team, updateCounter]);

  const gridData = useDataSource({
    data: extendedUsers,
    columns: teamMemberColumns,
    getRowId: (row) => row.id,
    sorting: gridState.sorting,
    quickSearch: gridState.quickSearch,
    pagination: gridState.pagination,
    paginationMode: "client",
  });

  return (
    <DataGrid
      columns={teamMemberColumns}
      rows={gridData.rows}
      getRowId={(row) => row.id}
      totalRowCount={gridData.totalRowCount}
      isLoading={isLoadingExtendedUsers}
      state={gridState}
      onChange={setGridState}
      rowHeight="auto"
      estimatedRowHeight={44}
      fillHeight={false}
    />
  );
}
