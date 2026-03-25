"use client";
import { PermissionGraph } from "@/components/permission-field";
import {
  DesignBadge,
  DesignButton,
  DesignCard,
  DesignEditableGrid,
  type DesignEditableGridItem,
} from "@/components/design-components";
import { ActionDialog, Checkbox, Switch, Typography } from "@/components/ui";
import { useUpdateConfig } from "@/lib/config-update";
import { GearSix, ShieldCheck, ShieldIcon, UserPlus, UsersIcon } from "@phosphor-icons/react";
import { typedFromEntries } from "@stackframe/stack-shared/dist/utils/objects";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppEnabledGuard } from "../app-enabled-guard";
import { PageLayout } from "../page-layout";
import { useAdminApp } from "../use-admin-app";

function PermissionSelectDialog(props: {
  trigger: React.ReactNode,
  type: "creator" | "member",
}) {
  const stackAdminApp = useAdminApp();
  const project = stackAdminApp.useProject();
  const config = project.useConfig();
  const permissions = stackAdminApp.useTeamPermissionDefinitions();
  const updateConfig = useUpdateConfig();

  const [open, setOpen] = useState(false);

  const defaultPermissions = props.type === "creator"
    ? config.rbac.defaultPermissions.teamCreator
    : config.rbac.defaultPermissions.teamMember;

  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  // Reset selection when dialog opens
  useEffect(() => {
    if (open) {
      setSelectedIds(Object.keys(defaultPermissions).filter(id => defaultPermissions[id]));
    }
  }, [open, defaultPermissions]);

  // Recompute graph from current selection (avoids stale closure issues)
  const graph = useMemo(() => {
    if (!open) return null;
    return new PermissionGraph(permissions).addPermission(selectedIds);
  }, [open, permissions, selectedIds]);

  // Find the sentinel entry (the synthetic "currently edited" permission)
  const sentinelId = useMemo(() => {
    if (!graph) return null;
    return [...graph.permissions.keys()].find(
      id => !permissions.some(orig => orig.id === id)
    ) ?? null;
  }, [graph, permissions]);

  const handleToggle = useCallback((permissionId: string, checked: boolean) => {
    setSelectedIds(prev =>
      checked
        ? [...new Set([...prev, permissionId])]
        : prev.filter(id => id !== permissionId)
    );
  }, []);

  const handleSave = async () => {
    const permissionsMap = typedFromEntries(selectedIds.map((id) => [id, true]));
    const configKey = props.type === "creator"
      ? 'rbac.defaultPermissions.teamCreator'
      : 'rbac.defaultPermissions.teamMember';

    await updateConfig({
      adminApp: stackAdminApp,
      configUpdate: {
        [configKey]: permissionsMap,
      },
      pushable: true,
    });
  };

  return (
    <ActionDialog
      trigger={props.trigger}
      title={props.type === "creator" ? "Team Creator Default Permissions" : "Team Member Default Permissions"}
      description="Select the permissions that will be automatically granted."
      open={open}
      onOpenChange={setOpen}
      okButton={{ label: "Save", onClick: handleSave }}
      cancelButton
    >
      <div className="space-y-1">
        <p className="text-xs font-semibold text-foreground uppercase tracking-wider mb-2">
          Default Permissions
        </p>
        <div className="rounded-xl border border-border/50 bg-foreground/[0.02] max-h-64 overflow-y-auto">
          {permissions.map(permission => {
            const isSelected = selectedIds.includes(permission.id);

            let inheritedFrom: string | false = false;
            if (graph && sentinelId) {
              const contain = graph.hasPermission(sentinelId, permission.id);
              const ancestors = graph.recursiveAncestors(permission.id)
                .map(p => p.id)
                .filter(id => id !== permission.id && id !== sentinelId && selectedIds.includes(id));
              inheritedFrom = contain && ancestors.length > 0 && `(from ${ancestors.join(', ')})`;
            }

            return (
              <label
                key={permission.id}
                className="flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-foreground/[0.03] transition-colors duration-150 hover:transition-none first:rounded-t-xl last:rounded-b-xl"
              >
                <Checkbox
                  checked={isSelected}
                  onCheckedChange={(checked) => handleToggle(permission.id, !!checked)}
                />
                <span className="text-sm text-foreground">
                  {permission.id}
                </span>
                {inheritedFrom && (
                  <span className="text-xs text-muted-foreground ml-auto">
                    {inheritedFrom}
                  </span>
                )}
              </label>
            );
          })}
        </div>
      </div>
    </ActionDialog>
  );
}

export default function PageClient() {
  const stackAdminApp = useAdminApp();
  const project = stackAdminApp.useProject();
  const config = project.useConfig();
  const updateConfig = useUpdateConfig();

  const [localClientTeamCreation, setLocalClientTeamCreation] = useState<boolean | undefined>(undefined);
  const [localPersonalTeamOnSignUp, setLocalPersonalTeamOnSignUp] = useState<boolean | undefined>(undefined);

  const clientTeamCreation = localClientTeamCreation ?? config.teams.allowClientTeamCreation;
  const personalTeamOnSignUp = localPersonalTeamOnSignUp ?? config.teams.createPersonalTeamOnSignUp;

  const hasChanges = useMemo(() =>
    localClientTeamCreation !== undefined || localPersonalTeamOnSignUp !== undefined,
  [localClientTeamCreation, localPersonalTeamOnSignUp]);

  const modifiedKeys = useMemo(() => new Set([
    ...(localClientTeamCreation !== undefined ? ["client-team-creation"] : []),
    ...(localPersonalTeamOnSignUp !== undefined ? ["personal-team-signup"] : []),
  ]), [localClientTeamCreation, localPersonalTeamOnSignUp]);

  const handleSave = async () => {
    const configUpdate: Record<string, boolean> = {};
    if (localClientTeamCreation !== undefined) {
      configUpdate['teams.allowClientTeamCreation'] = localClientTeamCreation;
    }
    if (localPersonalTeamOnSignUp !== undefined) {
      configUpdate['teams.createPersonalTeamOnSignUp'] = localPersonalTeamOnSignUp;
    }
    await updateConfig({
      adminApp: stackAdminApp,
      configUpdate,
      pushable: true,
    });
    setLocalClientTeamCreation(undefined);
    setLocalPersonalTeamOnSignUp(undefined);
  };

  const handleDiscard = () => {
    setLocalClientTeamCreation(undefined);
    setLocalPersonalTeamOnSignUp(undefined);
  };

  const teamCreationItems: DesignEditableGridItem[] = [
    {
      itemKey: "client-team-creation",
      type: "custom",
      icon: <UsersIcon className="h-3.5 w-3.5" />,
      name: "Client Team Creation",
      tooltip: "Controls whether users can create teams from account settings and the team switcher",
      children: (
        <Switch
          checked={clientTeamCreation}
          onCheckedChange={(checked) => {
            if (checked === config.teams.allowClientTeamCreation) {
              setLocalClientTeamCreation(undefined);
            } else {
              setLocalClientTeamCreation(checked);
            }
          }}
        />
      ),
    },
    {
      itemKey: "personal-team-signup",
      type: "custom",
      icon: <UserPlus className="h-3.5 w-3.5" />,
      name: "Personal Team on Sign-up",
      tooltip: "Creates a personal team for each new user on sign-up (does not affect existing users)",
      children: (
        <Switch
          checked={personalTeamOnSignUp}
          onCheckedChange={(checked) => {
            if (checked === config.teams.createPersonalTeamOnSignUp) {
              setLocalPersonalTeamOnSignUp(undefined);
            } else {
              setLocalPersonalTeamOnSignUp(checked);
            }
          }}
        />
      ),
    },
  ];

  const teamCreatorPermissions = Object.keys(config.rbac.defaultPermissions.teamCreator)
    .filter(id => config.rbac.defaultPermissions.teamCreator[id]);
  const teamMemberPermissions = Object.keys(config.rbac.defaultPermissions.teamMember)
    .filter(id => config.rbac.defaultPermissions.teamMember[id]);

  return (
    <AppEnabledGuard appId="teams">
      <PageLayout title="Team Settings">
        <DesignCard
          title="Team Creation"
          subtitle="Control how teams are created in your project"
          icon={GearSix}
          glassmorphic
        >
          <DesignEditableGrid
            items={teamCreationItems}
            columns={1}
            deferredSave
            hasChanges={hasChanges}
            onSave={handleSave}
            onDiscard={handleDiscard}
            externalModifiedKeys={modifiedKeys}
          />
        </DesignCard>

        {([
          {
            type: 'creator' as const,
            title: "Team Creator Default Permissions",
            subtitle: "Permissions automatically granted when creating a team",
            permissions: teamCreatorPermissions,
            icon: ShieldCheck,
          }, {
            type: 'member' as const,
            title: "Team Member Default Permissions",
            subtitle: "Permissions automatically granted when joining a team",
            permissions: teamMemberPermissions,
            icon: ShieldIcon,
          }
        ]).map(({ type, title, subtitle, permissions, icon }) => (
          <DesignCard
            key={type}
            title={title}
            subtitle={subtitle}
            icon={icon}
            glassmorphic
            actions={
              <PermissionSelectDialog
                trigger={<DesignButton variant="secondary" size="sm">Edit</DesignButton>}
                type={type}
              />
            }
          >
            <div className="flex flex-wrap gap-2">
              {permissions.length > 0 ?
                permissions.map((id) => (
                  <DesignBadge key={id} label={id} color="blue" size="sm" />
                )) :
                <Typography variant="secondary" type="label">No default permissions set</Typography>
              }
            </div>
          </DesignCard>
        ))}
      </PageLayout>
    </AppEnabledGuard>
  );
}
