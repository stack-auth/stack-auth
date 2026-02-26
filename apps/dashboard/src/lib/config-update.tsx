'use client';

import { Link } from "@/components/link";
import { ActionDialog } from "@/components/ui/action-dialog";
import { getPublicEnvVar } from "@/lib/env";
import type { PushedConfigSource, StackAdminApp } from "@stackframe/stack";
import type { EnvironmentConfigOverrideOverride } from "@stackframe/stack-shared/dist/config/schema";
import React, { createContext, useCallback, useContext, useState } from "react";

type ConfigUpdateDialogState = {
  isOpen: boolean,
  adminApp: StackAdminApp<false> | null,
  configUpdate: EnvironmentConfigOverrideOverride | null,
  resolve: ((result: boolean) => void) | null,
  source: PushedConfigSource | null,
  isLoadingSource: boolean,
  // For GitHub dialog
  commitMessage: string,
  // Temporary: 50/50 chance of showing "Connect with GitHub" vs "Push changes"
  showConnectWithGitHub: boolean,
};

const ConfigUpdateDialogContext = createContext<{
  showPushableDialog: (adminApp: StackAdminApp<false>, configUpdate: EnvironmentConfigOverrideOverride) => Promise<boolean>,
} | null>(null);

/**
 * Provider component that enables the config update dialog functionality.
 * Wrap your app or page with this provider to use the `updateConfig` utility.
 */
export function ConfigUpdateDialogProvider({ children }: { children: React.ReactNode }) {
  const [dialogState, setDialogState] = useState<ConfigUpdateDialogState>({
    isOpen: false,
    adminApp: null,
    configUpdate: null,
    resolve: null,
    source: null,
    isLoadingSource: false,
    commitMessage: "",
    showConnectWithGitHub: false,
  });

  const showPushableDialog = useCallback(async (adminApp: StackAdminApp<false>, configUpdate: EnvironmentConfigOverrideOverride): Promise<boolean> => {
    // Fetch the source first
    const project = await adminApp.getProject();
    const source = await project.getPushedConfigSource();
    const isLocalEmulator = getPublicEnvVar("NEXT_PUBLIC_STACK_IS_LOCAL_EMULATOR") === "true";

    let shouldUpdate = true;
    if (source.type !== "unlinked") {
      shouldUpdate = await new Promise((resolve) => {
        setDialogState({
          isOpen: true,
          adminApp,
          configUpdate,
          resolve,
          source,
          isLoadingSource: false,
          commitMessage: "",
          // Temporary: 50/50 chance for GitHub dialog
          showConnectWithGitHub: Math.random() < 0.5,
        });
      });
    }

    if (shouldUpdate) {
      await project.updatePushedConfig(configUpdate);
      if (!isLocalEmulator) {
        await project.resetConfigOverrideKeys("environment", Object.keys(configUpdate));
      }
      return true;
    }
    return false;
  }, []);

  const handleClose = useCallback((result: boolean) => {
    if (dialogState.resolve) {
      dialogState.resolve(result);
    }
    setDialogState({
      isOpen: false,
      adminApp: null,
      configUpdate: null,
      resolve: null,
      source: null,
      isLoadingSource: false,
      commitMessage: "",
      showConnectWithGitHub: false,
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps -- we only care about the resolve function, not the entire dialogState
  }, [dialogState.resolve]);

  const projectId = dialogState.adminApp?.projectId;

  // Render the appropriate dialog based on source type
  const renderDialog = () => {
    if (!dialogState.isOpen || !dialogState.source) {
      return null;
    }

    switch (dialogState.source.type) {
      case "pushed-from-github": {
        return (
          <ActionDialog
            open={dialogState.isOpen}
            onClose={() => handleClose(false)}
            title="Push Configuration to GitHub"
            description="This project's configuration is managed via GitHub."
            okButton={dialogState.showConnectWithGitHub ? {
              label: "Connect with GitHub",
              onClick: async () => {
                // TODO: Implement GitHub OAuth connection
                alert("TODO: GitHub connection not yet implemented");
              },
            } : {
              label: "Push to GitHub",
              onClick: async () => {
                // TODO: Implement actual GitHub push
                alert("TODO: GitHub push not yet implemented");
              },
            }}
            cancelButton={{
              label: "Cancel",
              onClick: async () => {
                handleClose(false);
              },
            }}
          >
            <div className="space-y-4">
              {!dialogState.showConnectWithGitHub && (
                <div className="space-y-2">
                  <label htmlFor="commit-message" className="text-sm font-medium">
                    Commit message
                  </label>
                  <input
                    id="commit-message"
                    type="text"
                    className="w-full px-3 py-2 border rounded-md text-sm bg-background"
                    placeholder="Update Stack Auth configuration"
                    value={dialogState.commitMessage}
                    onChange={(e) => setDialogState(s => ({ ...s, commitMessage: e.target.value }))}
                  />
                </div>
              )}
              <p className="text-sm text-muted-foreground">
                <em>
                  If your configuration is no longer on GitHub, you can unlink it in{" "}
                  <Link href={`/projects/${projectId}/project-settings`} className="underline">
                    Project Settings
                  </Link>.
                </em>
              </p>
            </div>
          </ActionDialog>
        );
      }

      case "pushed-from-unknown": {
        return (
          <ActionDialog
            open={dialogState.isOpen}
            onClose={() => handleClose(false)}
            title="Configuration Managed by CLI"
            description="This project's configuration was pushed via the Stack Auth CLI."
            okButton={{
              label: "Go to Project Settings",
              onClick: async () => {
                // Navigate to project settings
                window.location.href = `/projects/${projectId}/project-settings`;
              },
            }}
            cancelButton={{
              label: "Cancel",
              onClick: async () => {
                handleClose(false);
              },
            }}
          >
            <div className="text-sm text-muted-foreground space-y-2">
              <p>
                To make changes, you can either:
              </p>
              <ul className="list-disc list-inside space-y-1 ml-2">
                <li>Push updates through the Stack Auth CLI</li>
                <li>Unlink the CLI in Project Settings to edit directly on this dashboard</li>
              </ul>
            </div>
          </ActionDialog>
        );
      }

      default: {
        // This shouldn't happen since unlinked saves directly, but handle it anyway
        return null;
      }
    }
  };

  return (
    <ConfigUpdateDialogContext.Provider value={{ showPushableDialog }}>
      {children}
      {renderDialog()}
    </ConfigUpdateDialogContext.Provider>
  );
}

function useConfigUpdateDialog() {
  const context = useContext(ConfigUpdateDialogContext);
  if (!context) {
    throw new Error("useConfigUpdateDialog must be used within a ConfigUpdateDialogProvider");
  }
  return context;
}

/**
 * Options for the updateConfig utility function.
 */
export type UpdateConfigOptions = {
  /**
   * The admin app instance to use for updating the config.
   */
  adminApp: StackAdminApp<false>,
  /**
   * The configuration update to apply.
   */
  configUpdate: EnvironmentConfigOverrideOverride,
  /**
   * Whether this configuration can be pushed (i.e., it's a branch-level config).
   * If true, shows a confirmation dialog before applying (based on source type).
   * If false, the update is applied directly to the environment config.
   */
  pushable: boolean,
};

/**
 * Hook that returns a function to update config with optional confirmation dialog.
 *
 * For pushable configs, the behavior depends on the branch config source:
 * - `unlinked`: Saves directly without a dialog
 * - `pushed-from-github`: Shows a dialog to push changes to GitHub
 * - `pushed-from-unknown`: Shows a dialog explaining CLI management
 *
 * For non-pushable configs, updates the environment config directly.
 *
 * @example
 * ```tsx
 * const updateConfig = useUpdateConfig();
 *
 * // Update environment config (no dialog)
 * await updateConfig({
 *   adminApp,
 *   configUpdate: { 'auth.oauth.providers.google.clientSecret': 'secret' },
 *   pushable: false,
 * });
 *
 * // Update pushed config (dialog depends on source)
 * await updateConfig({
 *   adminApp,
 *   configUpdate: { 'teams.allowClientTeamCreation': true },
 *   pushable: true,
 * });
 * ```
 */
export function useUpdateConfig() {
  const { showPushableDialog } = useConfigUpdateDialog();
  const isLocalEmulator = getPublicEnvVar("NEXT_PUBLIC_STACK_IS_LOCAL_EMULATOR") === "true";

  return useCallback(async (options: UpdateConfigOptions): Promise<boolean> => {
    const { adminApp, configUpdate, pushable } = options;

    if (pushable) {
      // Show dialog (or save directly if unlinked) based on source type
      return await showPushableDialog(adminApp, configUpdate);
    } else {
      if (isLocalEmulator) {
        alert("These settings are read-only in the local emulator. Update them in your production deployment instead.");
        return false;
      }
      // Update environment config directly
      const project = await adminApp.getProject();
      // eslint-disable-next-line no-restricted-syntax -- this is the hook implementation itself
      await project.updateConfig(configUpdate);
      return true;
    }
  }, [isLocalEmulator, showPushableDialog]);
}

/**
 * Props for the ConfigUpdateButton component.
 */
export type ConfigUpdateButtonProps = {
  /**
   * The admin app instance to use for updating the config.
   */
  adminApp: StackAdminApp<false>,
  /**
   * An async function that returns the configuration update to apply.
   * Called when the button is clicked.
   */
  configUpdate: () => Promise<EnvironmentConfigOverrideOverride>,
  /**
   * Whether this configuration can be pushed (i.e., it's a branch-level config).
   * If true, shows a confirmation dialog before applying.
   * If false, the update is applied directly to the environment config.
   */
  pushable: boolean,
  /**
   * Optional callback called after the config is successfully updated.
   */
  onUpdated?: () => void | Promise<void>,
  /**
   * The type of action this button represents.
   * - "save": Shows "Save changes" (for updating existing config)
   * - "create": Shows "Create" (for creating new config entries)
   */
  actionType: "save" | "create",
  /**
   * Whether the button should be disabled.
   */
  disabled?: boolean,
  /**
   * Additional class names for the button.
   */
  className?: string,
  /**
   * Button variant.
   */
  variant?: "default" | "secondary" | "outline" | "ghost" | "destructive" | "link",
  /**
   * Button size.
   */
  size?: "default" | "sm" | "lg" | "icon",
};

/**
 * A button component for saving configuration changes.
 *
 * Shows "Save changes" or "Create" based on the `actionType` prop and handles
 * the configuration update flow, including the confirmation dialog for pushable configs.
 *
 * @example
 * ```tsx
 * <ConfigUpdateButton
 *   adminApp={adminApp}
 *   configUpdate={async () => ({
 *     'teams.allowClientTeamCreation': true,
 *   })}
 *   pushable={true}
 *   onUpdated={() => toast({ title: "Settings saved" })}
 *   actionType="save"
 * />
 * ```
 */
export function ConfigUpdateButton({
  adminApp,
  configUpdate,
  pushable,
  onUpdated,
  actionType,
  disabled,
  className,
  variant = "default",
  size = "default",
}: ConfigUpdateButtonProps) {
  const updateConfig = useUpdateConfig();

  const handleClick = async () => {
    const configUpdateValue = await configUpdate();
    const success = await updateConfig({
      adminApp,
      configUpdate: configUpdateValue,
      pushable,
    });
    if (success) {
      await onUpdated?.();
    }
  };

  const label = actionType === "save" ? "Save changes" : "Create";

  // Import Button locally to avoid circular dependency issues
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { Button } = require("@/components/ui") as typeof import("@/components/ui");

  return (
    <Button
      onClick={handleClick}
      disabled={disabled}
      className={className}
      variant={variant}
      size={size}
    >
      {label}
    </Button>
  );
}

/**
 * Props for components that use the unsaved changes pattern.
 */
export type UnsavedChangesFooterProps = {
  /**
   * Whether there are unsaved changes.
   */
  hasChanges: boolean,
  /**
   * The admin app instance.
   */
  adminApp: StackAdminApp<false>,
  /**
   * An async function that returns the configuration update to apply.
   */
  configUpdate: () => Promise<EnvironmentConfigOverrideOverride>,
  /**
   * Whether this configuration can be pushed.
   */
  pushable: boolean,
  /**
   * Callback to discard changes (reset to original values).
   */
  onDiscard: () => void,
  /**
   * Optional callback called after the config is successfully updated.
   */
  onSaved?: () => void | Promise<void>,
  /**
   * The action type.
   */
  actionType?: "save" | "create",
};

/**
 * A footer component that shows Save/Discard buttons when there are unsaved changes.
 *
 * Use this at the bottom of a card or section to provide a consistent pattern
 * for saving configuration changes.
 *
 * @example
 * ```tsx
 * const [localValue, setLocalValue] = useState(config.someValue);
 * const hasChanges = localValue !== config.someValue;
 *
 * <UnsavedChangesFooter
 *   hasChanges={hasChanges}
 *   adminApp={adminApp}
 *   configUpdate={async () => ({ 'some.config.key': localValue })}
 *   pushable={true}
 *   onDiscard={() => setLocalValue(config.someValue)}
 *   onSaved={() => toast({ title: "Settings saved" })}
 * />
 * ```
 */
export function UnsavedChangesFooter({
  hasChanges,
  adminApp,
  configUpdate,
  pushable,
  onDiscard,
  onSaved,
  actionType = "save",
}: UnsavedChangesFooterProps) {
  // Import Button locally to avoid circular dependency issues
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { Button } = require("@/components/ui") as typeof import("@/components/ui");

  if (!hasChanges) {
    return null;
  }

  return (
    <div className="flex items-center justify-end gap-2 pt-4 border-t border-border/40">
      <Button
        variant="ghost"
        size="sm"
        onClick={onDiscard}
      >
        Discard changes
      </Button>
      <ConfigUpdateButton
        adminApp={adminApp}
        configUpdate={configUpdate}
        pushable={pushable}
        onUpdated={onSaved}
        actionType={actionType}
        size="sm"
      />
    </div>
  );
}
