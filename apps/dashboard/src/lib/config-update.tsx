'use client';

import { ActionDialog } from "@/components/ui/action-dialog";
import type { StackAdminApp } from "@stackframe/stack";
import type { EnvironmentConfigOverrideOverride } from "@stackframe/stack-shared/dist/config/schema";
import React, { createContext, useCallback, useContext, useState } from "react";

type ConfigUpdateDialogState = {
  isOpen: boolean,
  adminApp: StackAdminApp<false> | null,
  configUpdate: EnvironmentConfigOverrideOverride | null,
  resolve: ((result: boolean) => void) | null,
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
  });

  const showPushableDialog = useCallback((adminApp: StackAdminApp<false>, configUpdate: EnvironmentConfigOverrideOverride): Promise<boolean> => {
    return new Promise((resolve) => {
      setDialogState({
        isOpen: true,
        adminApp,
        configUpdate,
        resolve,
      });
    });
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
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps -- we only care about the resolve function, not the entire dialogState
  }, [dialogState.resolve]);

  return (
    <ConfigUpdateDialogContext.Provider value={{ showPushableDialog }}>
      {children}
      <ActionDialog
        open={dialogState.isOpen}
        onClose={() => handleClose(false)}
        title="Update Pushed Configuration"
        description="This change will be applied to the pushed configuration. Note that this change will be lost the next time the configuration is pushed."
        okButton={{
          label: "Update Pushed Config",
          onClick: async () => {
            // Perform the config update here so the button shows loading state
            if (dialogState.adminApp && dialogState.configUpdate) {
              const project = await dialogState.adminApp.getProject();
              await project.updatePushedConfig(dialogState.configUpdate as any);
            }
            handleClose(true);
          },
        }}
        cancelButton={{
          label: "Cancel",
          onClick: async () => {
            handleClose(false);
          },
        }}
      >
        <div className="text-sm text-muted-foreground">
          <p className="mb-2">
            <strong>Tip:</strong> If you want this change to persist across pushes, consider using
            the environment configuration instead (e.g., for secrets and API keys).
          </p>
          <p>
            For changes that should be part of your pushed config, update your source configuration
            and push again.
          </p>
        </div>
      </ActionDialog>
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
   * If true, shows a confirmation dialog before applying.
   * If false, the update is applied directly to the environment config.
   */
  pushable: boolean,
};

/**
 * Hook that returns a function to update config with optional confirmation dialog.
 *
 * For pushable configs, shows a dialog asking the user to confirm before updating
 * the pushed config. The dialog explains that these changes will be lost on the
 * next push.
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
 * // Update pushed config (shows confirmation dialog)
 * await updateConfig({
 *   adminApp,
 *   configUpdate: { 'teams.allowClientTeamCreation': true },
 *   pushable: true,
 * });
 * ```
 */
export function useUpdateConfig() {
  const { showPushableDialog } = useConfigUpdateDialog();

  return useCallback(async (options: UpdateConfigOptions): Promise<boolean> => {
    const { adminApp, configUpdate, pushable } = options;

    if (pushable) {
      // Show confirmation dialog for pushable configs
      // The dialog handles the actual config update so the button can show loading state
      return await showPushableDialog(adminApp, configUpdate);
    } else {
      // Update environment config directly
      const project = await adminApp.getProject();
      // Cast to any because the strict type guard prevents direct usage
      await project.updateConfig(configUpdate as any);
      return true;
    }
  }, [showPushableDialog]);
}

