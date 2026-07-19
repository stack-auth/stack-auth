"use client";
import { CopyableText } from "@/components/copyable-text";
import { SmartFormDialog } from "@/components/form-dialog";
import { Link, StyledLink } from "@/components/link";
import { LogoUpload } from "@/components/logo-upload";
import {
  DesignAlert,
  DesignBadge,
  DesignButton,
  DesignCard,
  DesignDialog,
  DesignDialogClose,
  DesignEditableGrid,
  DesignInput,
  DesignPillToggle,
  type DesignEditableGridItem,
} from "@/components/design-components";
import { ActionDialog, Avatar, AvatarFallback, AvatarImage, SimpleTooltip, Switch, useToast } from "@/components/ui";
import { useDashboardInternalUser } from "@/lib/dashboard-user";
import { getPublicEnvVar } from "@/lib/env";
import {
  DataGrid,
  createDefaultDataGridState,
  useDataSource,
  type DataGridColumnDef,
} from "@hexclave/dashboard-ui-components";
import type { PushedConfigSource, TeamUser } from "@hexclave/next";
import { TeamSwitcher } from "@hexclave/next";
import { fromNow } from "@hexclave/shared/dist/utils/dates";
import { throwErr } from "@hexclave/shared/dist/utils/errors";
import { runAsynchronouslyWithAlert } from "@hexclave/shared/dist/utils/promises";
import {
  CaretRightIcon,
  DiamondIcon,
  MagnifyingGlassIcon,
  PencilSimpleIcon,
  UploadSimpleIcon,
  UsersIcon,
  WarningIcon,
} from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import * as yup from "yup";
import { PageLayout } from "../page-layout";
import { useAdminApp } from "../use-admin-app";

const projectInformationSchema = yup.object().shape({
  displayName: yup.string().defined(),
  description: yup.string(),
});

type ConfigSourceId = "github" | "cli" | "dashboard";
type MemberRole = "Admin" | "Member";

type AccessMemberRow = {
  id: string,
  displayName: string,
  profileImageUrl: string | null,
  role: MemberRole,
  lastActiveAt: Date | null,
};

type LastActiveByUserId = Map<string, Date | null>;

function getConfigSourceId(source: PushedConfigSource | null): ConfigSourceId {
  if (source?.type === "pushed-from-github") return "github";
  if (source?.type === "pushed-from-unknown") return "cli";
  return "dashboard";
}

function roleBadgeColor(role: MemberRole): "red" | "blue" | "green" {
  if (role === "Admin") return "blue";
  return "green";
}

const accessMemberColumns: DataGridColumnDef<AccessMemberRow>[] = [
  {
    id: "member",
    header: "Member",
    accessor: "displayName",
    type: "string",
    width: 240,
    renderCell: ({ row }) => {
      const initials = row.displayName === "Name not set"
        ? "?"
        : row.displayName.slice(0, 2).toUpperCase();
      return (
        <div className="flex items-center gap-3">
          <Avatar className="h-8 w-8">
            <AvatarImage src={row.profileImageUrl ?? undefined} alt={row.displayName} />
            <AvatarFallback className="text-xs">{initials}</AvatarFallback>
          </Avatar>
          <span className="truncate text-sm font-semibold text-foreground">{row.displayName}</span>
        </div>
      );
    },
  },
  {
    id: "role",
    header: "Role",
    accessor: "role",
    type: "string",
    width: 120,
    renderCell: ({ row }) => (
      <DesignBadge label={row.role} color={roleBadgeColor(row.role)} size="sm" />
    ),
  },
  {
    id: "lastActiveAt",
    header: "Last activity",
    accessor: (row) => row.lastActiveAt?.getTime() ?? 0,
    type: "number",
    width: 160,
    renderCell: ({ row }) => (
      <span className="text-sm text-muted-foreground">
        {row.lastActiveAt ? fromNow(row.lastActiveAt) : "Never"}
      </span>
    ),
  },
];

export default function PageClient() {
  const hexclaveAdminApp = useAdminApp();
  const project = hexclaveAdminApp.useProject();
  const productionModeErrors = project.useProductionModeErrors();
  const user = useDashboardInternalUser();
  const teams = user.useTeams();
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const [isTransferring, setIsTransferring] = useState(false);
  const [configSource, setConfigSource] = useState<PushedConfigSource | null>(null);
  const [isLoadingSource, setIsLoadingSource] = useState(true);
  const [isProjectDetailsDialogOpen, setIsProjectDetailsDialogOpen] = useState(false);
  const [isLogoDialogOpen, setIsLogoDialogOpen] = useState(false);
  const [isConfigExpanded, setIsConfigExpanded] = useState(false);
  const [isUnlinkDialogOpen, setIsUnlinkDialogOpen] = useState(false);
  const [configSourcePreview, setConfigSourcePreview] = useState<ConfigSourceId | null>(null);
  const [memberSearch, setMemberSearch] = useState("");
  const [adminUserIds, setAdminUserIds] = useState<Set<string>>(() => new Set());
  const [lastActiveByUserId, setLastActiveByUserId] = useState<LastActiveByUserId>(() => new Map());
  const { toast } = useToast();

  useEffect(() => {
    runAsynchronouslyWithAlert(async () => {
      try {
        const source = await project.getPushedConfigSource();
        setConfigSource(source);
      } finally {
        setIsLoadingSource(false);
      }
    });
  }, [project]);

  const handleUnlinkSource = useCallback(async () => {
    await project.unlinkPushedConfigSource();
    setConfigSource({ type: "unlinked" });
    setConfigSourcePreview(null);
    setIsUnlinkDialogOpen(false);
    toast({ title: "Configuration source unlinked", description: "You can now edit the configuration directly on this dashboard." });
  }, [project, toast]);

  const baseApiUrl = getPublicEnvVar("NEXT_PUBLIC_STACK_API_URL");

  const jwksUrl = useMemo(
    () => `${baseApiUrl}/api/v1/projects/${project.id}/.well-known/jwks.json`,
    [baseApiUrl, project.id]
  );
  const restrictedJwksUrl = useMemo(
    () => `${jwksUrl}?include_restricted=true`,
    [jwksUrl]
  );
  const allJwksUrl = useMemo(
    () => `${jwksUrl}?include_anonymous=true`,
    [jwksUrl]
  );

  const currentOwnerTeam = useMemo(
    () => teams.find(team => team.id === project.ownerTeamId) ?? throwErr(`Owner team of project ${project.id} not found in user's teams?`, { projectId: project.id, teams }),
    [teams, project.ownerTeamId, project.id]
  );

  const hasAdminPermissionForCurrentTeam = user.usePermission(currentOwnerTeam, "team_admin");

  const selectedTeam = useMemo(
    () => teams.find(team => team.id === selectedTeamId),
    [teams, selectedTeamId]
  );

  const currentTeamMembers = currentOwnerTeam.useUsers();

  useEffect(() => {
    let cancelled = false;
    runAsynchronouslyWithAlert(async () => {
      // Owner-team membership comes from the dashboard user API (TeamUser), which
      // doesn't include lastActiveAt or roles — pull those from the admin project APIs.
      const [permissions, usersPage] = await Promise.all([
        hexclaveAdminApp.listTeamMemberPermissions(currentOwnerTeam.id, { recursive: false }),
        hexclaveAdminApp.listUsers({
          teamId: currentOwnerTeam.id,
          limit: 100,
          orderBy: "lastActiveAt",
          desc: true,
          includeAnonymous: true,
          includeRestricted: true,
        }),
      ]);
      if (cancelled) return;

      const nextAdmins = new Set<string>();
      for (const { userId, permissionId } of permissions) {
        if (permissionId === "team_admin") {
          nextAdmins.add(userId);
        }
      }
      setAdminUserIds(nextAdmins);

      const nextLastActive: LastActiveByUserId = new Map();
      for (const member of usersPage) {
        nextLastActive.set(member.id, member.lastActiveAt);
      }
      setLastActiveByUserId(nextLastActive);
    });
    return () => {
      cancelled = true;
    };
  }, [hexclaveAdminApp, currentOwnerTeam.id]);

  const teamSettingsPath = useMemo(
    () => `/projects?team_settings=${encodeURIComponent(currentOwnerTeam.id)}`,
    [currentOwnerTeam.id]
  );

  const handleTransfer = useCallback(async () => {
    if (!selectedTeamId || selectedTeamId === project.ownerTeamId) return;
    if (isTransferring) return;

    setIsTransferring(true);
    try {
      await user.transferProject(project.id, selectedTeamId);
      toast({
        title: "Project transferred successfully",
        variant: "success",
      });
      // Reload so ownership changes are unmistakably reflected after a large action.
      window.location.reload();
    } finally {
      setIsTransferring(false);
    }
  }, [selectedTeamId, project.ownerTeamId, project.id, user, toast, isTransferring]);

  const handleLogoChange = useCallback(async (logoUrl: string | null) => {
    await project.update({ logoUrl });
  }, [project]);

  const handleFullLogoChange = useCallback(async (logoFullUrl: string | null) => {
    await project.update({ logoFullUrl });
  }, [project]);

  const handleProductionModeChange = useCallback(async (checked: boolean) => {
    await project.update({ isProductionMode: checked });
  }, [project]);

  const handleTeamSwitcherChange = useCallback(async (team: { id: string }) => {
    setSelectedTeamId(team.id);
  }, []);

  const handleProjectDetailsSubmit = useCallback(async (values: yup.InferType<typeof projectInformationSchema>) => {
    await project.update(values);
  }, [project]);

  const projectDetailsDefaultValues = useMemo(() => ({
    displayName: project.displayName,
    description: project.description || undefined,
  }), [project.displayName, project.description]);

  const handleProjectDelete = useCallback(async () => {
    await project.delete();
    await hexclaveAdminApp.redirectToHome();
  }, [project, hexclaveAdminApp]);

  const configSourceId = getConfigSourceId(configSource);
  const isProductionReady = productionModeErrors.length === 0;

  const accessRows = useMemo((): AccessMemberRow[] => {
    return currentTeamMembers.map((member: TeamUser) => {
      const displayName = member.teamProfile.displayName?.trim() || "Name not set";
      return {
        id: member.id,
        displayName,
        profileImageUrl: member.teamProfile.profileImageUrl,
        role: adminUserIds.has(member.id) ? "Admin" : "Member",
        lastActiveAt: lastActiveByUserId.get(member.id) ?? null,
      };
    });
  }, [currentTeamMembers, adminUserIds, lastActiveByUserId]);

  const filteredAccessRows = useMemo(() => {
    const query = memberSearch.trim().toLowerCase();
    if (query.length === 0) return accessRows;
    return accessRows.filter((row) => row.displayName.toLowerCase().includes(query));
  }, [accessRows, memberSearch]);

  const [gridState, setGridState] = useState(() => createDefaultDataGridState(accessMemberColumns));
  const gridData = useDataSource({
    data: filteredAccessRows,
    columns: accessMemberColumns,
    getRowId: (row) => row.id,
    sorting: gridState.sorting,
    quickSearch: gridState.quickSearch,
    pagination: gridState.pagination,
    paginationMode: "client",
  });

  const productionModeItems: DesignEditableGridItem[] = [
    {
      itemKey: "production-mode",
      type: "custom",
      icon: <DiamondIcon className="h-3.5 w-3.5" />,
      name: "Enable production mode",
      children: (
        <Switch
          checked={project.isProductionMode}
          disabled={!project.isProductionMode && productionModeErrors.length > 0}
          onCheckedChange={(checked) => {
            runAsynchronouslyWithAlert(handleProductionModeChange(checked));
          }}
        />
      ),
    },
  ];

  const selectedConfigSourcePreview = configSourcePreview ?? configSourceId;

  const handleConfigSourcePreviewSelect = (id: string) => {
    if (id === "github" || id === "cli" || id === "dashboard") {
      setConfigSourcePreview(id);
      return;
    }
    throwErr(`Unexpected configuration source preview "${id}"`);
  };

  return (
    <PageLayout title="Project Settings" description="Manage your project" allowContentOverflow>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">Configuration source preview</p>
        <DesignPillToggle
          options={[
            { id: "github", label: "GitHub" },
            { id: "cli", label: "CLI" },
            { id: "dashboard", label: "Dashboard" },
          ]}
          selected={isLoadingSource ? "dashboard" : selectedConfigSourcePreview}
          onSelect={handleConfigSourcePreviewSelect}
          size="sm"
          gradient="default"
        />
      </div>

      <DesignCard glassmorphic>
        <div className="space-y-5">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
            <div className="flex w-fit flex-col items-center gap-2">
              <button
                type="button"
                onClick={() => setIsLogoDialogOpen(true)}
                className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-xl border border-border/60 bg-foreground/[0.03] transition-colors duration-150 hover:bg-foreground/[0.05] hover:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label="Manage logo"
              >
                {project.logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={project.logoUrl} alt={`${project.displayName} logo`} className="h-full w-full object-contain" />
                ) : (
                  <UploadSimpleIcon className="h-6 w-6 text-muted-foreground" />
                )}
              </button>
              <DesignButton variant="link" size="sm" className="h-auto px-0" onClick={() => setIsLogoDialogOpen(true)}>
                Manage Logo
              </DesignButton>
            </div>

            <div className="min-w-0 flex-1 space-y-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-semibold tracking-tight text-foreground">{project.displayName}</h2>
                  <DesignButton
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => setIsProjectDetailsDialogOpen(true)}
                    aria-label="Edit project details"
                  >
                    <PencilSimpleIcon className="h-4 w-4" />
                  </DesignButton>
                </div>
                <p className="text-sm text-muted-foreground">
                  {project.description || "No project description has been added."}
                </p>
              </div>

              <div className="max-w-xl space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Project ID</p>
                <CopyableText value={project.id} />
              </div>
            </div>
          </div>

          <DesignAlert
            variant="info"
            description={(
              <>
                Looking for project API keys?{" "}
                <StyledLink href={`/projects/${project.id}/project-keys`}>
                  Head over to the Project Keys Page
                </StyledLink>
              </>
            )}
          />

          <div className="rounded-xl border border-border/60 bg-foreground/[0.02]">
            <button
              type="button"
              onClick={() => setIsConfigExpanded((open) => !open)}
              className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors duration-150 hover:bg-foreground/[0.03] hover:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-xl"
            >
              <div className="flex min-w-0 items-center gap-3">
                <DiamondIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">Project Configuration</p>
                  <p className="text-xs text-muted-foreground">JWKS URLs and Configuration Source</p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <DesignBadge
                  label={isLoadingSource ? "Loading" : selectedConfigSourcePreview === "github" ? "GitHub" : selectedConfigSourcePreview === "cli" ? "CLI" : "Dashboard"}
                  color="blue"
                  size="sm"
                />
                <CaretRightIcon className={`h-4 w-4 text-muted-foreground transition-transform duration-150 ${isConfigExpanded ? "rotate-90" : ""}`} />
              </div>
            </button>

            {isConfigExpanded && (
              <div className="space-y-4 border-t border-border/60 px-4 py-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                  <div className="space-y-1">
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Configuration source</p>
                    <p className="text-xs text-muted-foreground">
                      {selectedConfigSourcePreview !== configSourceId
                        ? `Previewing the ${selectedConfigSourcePreview === "github" ? "GitHub" : selectedConfigSourcePreview === "cli" ? "CLI" : "Dashboard"} configuration source.`
                        : configSource?.type === "pushed-from-github"
                          ? `${configSource.owner}/${configSource.repo} · ${configSource.branch}`
                          : configSource?.type === "pushed-from-unknown"
                            ? "Pushed via the Hexclave CLI."
                            : "Managed directly in this dashboard."}
                    </p>
                  </div>
                  {(configSource?.type === "pushed-from-github" || configSource?.type === "pushed-from-unknown") && selectedConfigSourcePreview === configSourceId && (
                    <DesignButton variant="secondary" size="sm" onClick={() => setIsUnlinkDialogOpen(true)}>
                      Unlink source
                    </DesignButton>
                  )}
                </div>

                {configSource?.type === "pushed-from-github" && (
                  <div className="rounded-lg bg-foreground/[0.03] p-3 text-xs text-muted-foreground space-y-1">
                    <div>Config file: {configSource.configFilePath}</div>
                    {configSource.workflowPath ? (
                      <div>
                        Workflow:{" "}
                        <a
                          className="underline"
                          target="_blank"
                          rel="noreferrer noopener"
                          href={`https://github.com/${encodeURIComponent(configSource.owner)}/${encodeURIComponent(configSource.repo)}/blob/${configSource.branch.split("/").map(encodeURIComponent).join("/")}/${configSource.workflowPath.split("/").map(encodeURIComponent).join("/")}`}
                        >
                          {configSource.workflowPath}
                        </a>
                      </div>
                    ) : null}
                    <div>Last commit: <code>{configSource.commitHash.substring(0, 7)}</code></div>
                  </div>
                )}

                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-foreground">JWKS URLs</p>
                    <SimpleTooltip type="info" tooltip="Use these URLs to allow other services to verify Hexclave-issued sessions for this project.">
                      <span className="sr-only">More info about JWKS URLs</span>
                    </SimpleTooltip>
                  </div>
                  <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-2 text-sm">
                    <span className="whitespace-nowrap text-muted-foreground">Standard</span>
                    <CopyableText value={jwksUrl} />
                    <div className="flex items-center gap-1 whitespace-nowrap text-muted-foreground">
                      <span>Restricted</span>
                      <SimpleTooltip type="info" tooltip="Includes keys for sessions of restricted users.">
                        <span className="sr-only">Info about restricted JWKS</span>
                      </SimpleTooltip>
                    </div>
                    <CopyableText value={restrictedJwksUrl} />
                    <div className="flex items-center gap-1 whitespace-nowrap text-muted-foreground">
                      <span>Anonymous</span>
                      <SimpleTooltip type="info" tooltip="Includes keys for anonymous sessions.">
                        <span className="sr-only">Info about anonymous JWKS</span>
                      </SimpleTooltip>
                    </div>
                    <CopyableText value={allJwksUrl} />
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </DesignCard>

      <DesignCard
        title="Project Access"
        subtitle="See who can manage this project and transfer ownership if needed."
        icon={UsersIcon}
        glassmorphic
      >
        <div className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <DesignButton asChild variant="secondary" size="sm">
              <Link href={teamSettingsPath}>Manage Team Members</Link>
            </DesignButton>
            <DesignInput
              size="sm"
              className="w-full sm:w-64"
              leadingIcon={<MagnifyingGlassIcon className="h-4 w-4" />}
              placeholder="Search Members..."
              value={memberSearch}
              onChange={(event) => setMemberSearch(event.target.value)}
            />
          </div>

          {filteredAccessRows.length === 0 ? (
            <p className="rounded-xl border border-border/50 bg-foreground/[0.02] px-4 py-6 text-center text-sm text-muted-foreground">
              {accessRows.length === 0 ? "This team has no members yet." : "No members match your search."}
            </p>
          ) : (
            <DataGrid
              columns={accessMemberColumns}
              rows={gridData.rows}
              getRowId={(row) => row.id}
              totalRowCount={gridData.totalRowCount}
              isLoading={gridData.isLoading}
              state={gridState}
              onChange={setGridState}
              toolbar={false}
              maxHeight={360}
            />
          )}
        </div>
      </DesignCard>

      <DesignCard glassmorphic>
        <div className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-1">
              <h3 className="text-base font-semibold text-foreground">Transfer Project Ownership</h3>
              <p className="text-sm text-muted-foreground">
                Everyone in this team can access and manage the project.
              </p>
            </div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span>Current Team:</span>
              <DesignBadge
                label={`${currentOwnerTeam.displayName || "Unnamed team"} (${currentTeamMembers.length})`}
                color="blue"
                size="sm"
                icon={UsersIcon}
              />
            </div>
          </div>

          {!hasAdminPermissionForCurrentTeam ? (
            <DesignAlert variant="error">
              {`You need to be a team admin of "${currentOwnerTeam.displayName || "the current team"}" to transfer this project.`}
            </DesignAlert>
          ) : (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="min-w-0 flex-1 space-y-2">
                <p className="text-sm text-muted-foreground">Transfer to a different team:</p>
                <TeamSwitcher
                  triggerClassName="w-full"
                  teamId={selectedTeamId || ""}
                  onChange={handleTeamSwitcherChange}
                />
              </div>
              <ActionDialog
                trigger={
                  <DesignButton
                    variant="secondary"
                    disabled={
                      !selectedTeam ||
                      selectedTeam.id === project.ownerTeamId ||
                      isTransferring
                    }
                  >
                    Transfer
                  </DesignButton>
                }
                title="Transfer Project"
                okButton={{
                  label: "Transfer Project",
                  onClick: handleTransfer,
                }}
                cancelButton
              >
                <p className="text-sm text-foreground">
                  {`Are you sure you want to transfer "${project.displayName}" to ${selectedTeam?.displayName}?`}
                </p>
                <p className="mt-2 text-sm text-muted-foreground">
                  This will change the ownership of the project. Only team admins of the new team will be able to manage project settings.
                </p>
              </ActionDialog>
            </div>
          )}
        </div>
      </DesignCard>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">Production readiness</p>
        <div
          className="inline-flex rounded-lg border border-border/60 bg-foreground/[0.03] p-1 text-xs"
          role="status"
          aria-label={`Production configuration is ${isProductionReady ? "ready" : "not ready"}`}
        >
          <span className={`rounded-md px-3 py-1.5 ${isProductionReady ? "bg-background font-medium text-foreground shadow-sm" : "text-muted-foreground"}`}>
            Ready
          </span>
          <span className={`rounded-md px-3 py-1.5 ${!isProductionReady ? "bg-background font-medium text-foreground shadow-sm" : "text-muted-foreground"}`}>
            Not ready
          </span>
        </div>
      </div>

      <div className="grid items-stretch gap-4 lg:grid-cols-2">
        <DesignCard
          title="Production Mode"
          subtitle="Production mode disables development shortcuts considered unsafe for production."
          icon={DiamondIcon}
          glassmorphic
          className="h-full"
        >
          <div className="space-y-4">
            <DesignEditableGrid items={productionModeItems} columns={1} deferredSave={false} />
            {isProductionReady ? (
              <DesignAlert
                variant="success"
                description="Your configuration is ready for production and production mode can be enabled."
              />
            ) : (
              <DesignAlert variant="error" title="Configuration not ready for production">
                <ul className="mt-1 list-disc pl-5">
                  {productionModeErrors.map((error) => (
                    <li key={error.message}>
                      {error.message} (<StyledLink href={error.relativeFixUrl}>show configuration</StyledLink>)
                    </li>
                  ))}
                </ul>
              </DesignAlert>
            )}
          </div>
        </DesignCard>

        <DesignCard
          title="Danger Zone"
          subtitle="Irreversible and destructive actions."
          icon={WarningIcon}
          className="h-full border-destructive/40 ring-1 ring-destructive/20"
          glassmorphic
        >
          <div className="flex h-full flex-col gap-5">
            <DesignAlert
              variant="error"
              title="Delete this project"
              description="This permanently removes all project data, users, teams, API keys, and configuration."
            />
            <div className="mt-auto flex flex-col gap-3 border-t border-destructive/20 pt-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-muted-foreground">
                This action cannot be undone.
              </p>
              <ActionDialog
                trigger={
                  <DesignButton variant="destructive" size="sm">
                    Delete Project
                  </DesignButton>
                }
                title="Delete Project"
                danger
                okButton={{
                  label: "Delete Project",
                  onClick: handleProjectDelete,
                }}
                cancelButton
                confirmText="I understand this action is IRREVERSIBLE and will delete ALL associated data."
              >
                <p className="text-sm text-foreground">
                  {`Are you sure that you want to delete the project with name "${project.displayName}" and ID "${project.id}"?`}
                </p>
                <p className="mt-2 text-sm text-foreground">
                  This action is <strong>irreversible</strong> and will permanently delete:
                </p>
                <ul className="mt-2 list-disc pl-5">
                  <li>All users and their data</li>
                  <li>All teams and team memberships</li>
                  <li>All API keys</li>
                  <li>All project configurations</li>
                  <li>All OAuth provider settings</li>
                </ul>
              </ActionDialog>
            </div>
          </div>
        </DesignCard>
      </div>

      <SmartFormDialog
        open={isProjectDetailsDialogOpen}
        onOpenChange={setIsProjectDetailsDialogOpen}
        title="Edit Project Details"
        formSchema={projectInformationSchema}
        defaultValues={projectDetailsDefaultValues}
        onSubmit={handleProjectDetailsSubmit}
        okButton={{ label: "Save" }}
        cancelButton
      />

      <DesignDialog
        open={isLogoDialogOpen}
        onOpenChange={setIsLogoDialogOpen}
        size="2xl"
        icon={UploadSimpleIcon}
        title="Manage Logo"
        description="Upload square and full logos for light and dark surfaces."
        footer={(
          <DesignDialogClose asChild>
            <DesignButton variant="secondary" size="sm">Done</DesignButton>
          </DesignDialogClose>
        )}
      >
        <div className="grid gap-5 sm:grid-cols-2">
          <LogoUpload
            label="Logo"
            value={project.logoUrl}
            onValueChange={handleLogoChange}
            description="Recommended size: 200x200px"
            type="logo"
          />
          <LogoUpload
            label="Full Logo"
            value={project.logoFullUrl}
            onValueChange={handleFullLogoChange}
            description="Recommended size: at least 100px tall, landscape"
            type="full-logo"
          />
          <LogoUpload
            label="Logo (Dark Mode)"
            value={project.logoDarkModeUrl}
            onValueChange={async (logoDarkModeUrl) => {
              await project.update({ logoDarkModeUrl });
            }}
            description="Recommended size: 200x200px"
            type="logo"
          />
          <LogoUpload
            label="Full Logo (Dark Mode)"
            value={project.logoFullDarkModeUrl}
            onValueChange={async (logoFullDarkModeUrl) => {
              await project.update({ logoFullDarkModeUrl });
            }}
            description="Recommended size: at least 100px tall, landscape"
            type="full-logo"
          />
        </div>
      </DesignDialog>

      <ActionDialog
        open={isUnlinkDialogOpen}
        onOpenChange={setIsUnlinkDialogOpen}
        title="Unlink Configuration Source"
        okButton={{
          label: "Unlink",
          onClick: handleUnlinkSource,
        }}
        cancelButton
      >
        <p className="text-sm text-foreground">
          Are you sure you want to unlink this configuration source?
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          After unlinking, you can edit the configuration directly on this dashboard. Future pushes will not update it until you reconnect.
        </p>
      </ActionDialog>
    </PageLayout>
  );
}
