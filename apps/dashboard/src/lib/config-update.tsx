'use client';

import { Link } from "@/components/link";
import { ActionDialog } from "@/components/ui/action-dialog";
import { fetchWithRemoteDevelopmentEnvironmentBrowserSecret, RemoteDevelopmentEnvironmentBrowserSecretRedirectingError } from "@/app/remote-development-environment-browser-secret-client";
import { useDashboardInternalUser } from "@/lib/dashboard-user";
import { getPublicEnvVar } from "@/lib/env";
import type { OAuthConnection, PushedConfigSource, StackAdminApp } from "@hexclave/next";
import type { EnvironmentConfigOverrideOverride } from "@hexclave/shared/dist/config/schema";
import { HexclaveAssertionError, captureError } from "@hexclave/shared/dist/utils/errors";
import { runAsynchronously } from "@hexclave/shared/dist/utils/promises";
import React, { createContext, Suspense, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { createGithubFetch, GITHUB_SCOPE_REQUIREMENTS } from "./github-api";
import { pushConfigUpdateToGitHub } from "./github-config-push";

type GithubPushedSource = Extract<PushedConfigSource, { type: "pushed-from-github" }>;

type ConfigUpdateDialogState = {
  isOpen: boolean,
  adminApp: StackAdminApp<false> | null,
  configUpdate: EnvironmentConfigOverrideOverride | null,
  resolve: ((result: boolean) => void) | null,
  source: PushedConfigSource | null,
  isLoadingSource: boolean,
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
  });

  const showPushableDialog = useCallback(async (adminApp: StackAdminApp<false>, configUpdate: EnvironmentConfigOverrideOverride): Promise<boolean> => {
    // Fetch the source first
    const project = await adminApp.getProject();
    const source = await project.getPushedConfigSource();

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
        });
      });
    }

    if (shouldUpdate) {
      await project.updatePushedConfig(configUpdate);
      if (!project.isDevelopmentEnvironment) {
        await project.resetConfigOverrideKeys("environment", Object.keys(configUpdate));
      }
      return true;
    }
    return false;
  }, []);

  const settleDialog = useCallback((result: boolean) => {
    // Pull `resolve` out before the state update so we never invoke it from
    // inside a setState updater — React strict mode double-invokes updaters,
    // which would call `resolve` twice. Promise resolution is idempotent so
    // this was harmless in practice, but the pattern is wrong.
    const resolve = dialogState.resolve;
    setDialogState({
      isOpen: false,
      adminApp: null,
      configUpdate: null,
      resolve: null,
      source: null,
      isLoadingSource: false,
    });
    resolve?.(result);
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
          <GithubPushDialog
            open={dialogState.isOpen}
            source={dialogState.source}
            configUpdate={dialogState.configUpdate}
            projectId={projectId}
            onSettle={settleDialog}
          />
        );
      }

      case "pushed-from-unknown": {
        return (
          <ActionDialog
            open={dialogState.isOpen}
            onClose={() => settleDialog(false)}
            title="Configuration Managed by CLI"
            description="This project's configuration was pushed via the Hexclave CLI."
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
                settleDialog(false);
              },
            }}
          >
            <div className="text-sm text-muted-foreground space-y-2">
              <p>
                To make changes, you can either:
              </p>
              <ul className="list-disc list-inside space-y-1 ml-2">
                <li>Push updates through the Hexclave CLI</li>
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

type GithubPushDialogProps = {
  open: boolean,
  source: GithubPushedSource,
  configUpdate: EnvironmentConfigOverrideOverride | null,
  projectId: string | undefined,
  onSettle: (result: boolean) => void,
};

/**
 * Renders the "Push to GitHub" dialog. Detects whether the dashboard user has
 * a GitHub account connected; if not, walks them through linking one first.
 * Once a connection is available, commits a config-file edit to the linked
 * repo/branch via the Contents API.
 *
 * On success, `onSettle(true)` is called so the surrounding
 * `ConfigUpdateDialogProvider` then mirrors the change into Hexclave's
 * cloud config for immediate UI feedback. Eventually the GitHub Actions
 * workflow will re-push the canonical config from the freshly-committed file.
 */
type ScopeCheck =
  | { status: "no-account" }
  | { status: "checking" }
  | { status: "ok", account: OAuthConnection }
  | { status: "missing-scopes" };

type GithubPushHandlers = {
  push: () => Promise<"prevent-close" | undefined>,
  connect: () => Promise<"prevent-close" | undefined>,
};

function projectSettingsHref(projectId: string | undefined): string {
  return `/projects/${projectId}/project-settings`;
}

/**
 * Outer shell. Renders `ActionDialog` synchronously (no suspending hooks) so
 * opening the dialog doesn't bubble a Suspense promise up to the dashboard
 * root and blank the page. The suspending pieces (current user, connected
 * accounts, OAuth token probe) live in `GithubPushBody`, wrapped in a local
 * `Suspense` boundary whose fallback mirrors the dialog body except that the
 * "Push to GitHub" button stays disabled while we resolve.
 */
function GithubPushDialog({ open, source, configUpdate, projectId, onSettle }: GithubPushDialogProps) {
  // Status starts as "checking" so the initial render shows a disabled
  // "Push to GitHub" button — matching what we want during Suspense fallback.
  const [scopeStatus, setScopeStatus] = useState<ScopeCheck["status"]>("checking");
  const handlersRef = useRef<GithubPushHandlers | null>(null);

  const dispatch = useCallback(
    (key: keyof GithubPushHandlers) => async (): Promise<"prevent-close" | undefined> => {
      // While the Suspense fallback is showing, handlers aren't registered
      // yet. In that window the button is disabled anyway, but we guard
      // defensively and prevent close if somehow clicked.
      return (await handlersRef.current?.[key]()) ?? "prevent-close";
    },
    [],
  );

  const okButton = (() => {
    switch (scopeStatus) {
      case "no-account": {
        return { label: "Connect with GitHub", onClick: dispatch("connect") };
      }
      case "checking": {
        return {
          label: "Push to GitHub",
          onClick: async (): Promise<"prevent-close" | undefined> => "prevent-close",
          props: { disabled: true },
        };
      }
      case "ok": {
        return { label: "Push to GitHub", onClick: dispatch("push") };
      }
      case "missing-scopes": {
        return { label: "Reconnect with GitHub", onClick: dispatch("connect") };
      }
    }
  })();

  const description = (() => {
    switch (scopeStatus) {
      case "no-account": {
        return "Connect a GitHub account to push configuration changes to this repository.";
      }
      case "checking": {
        return "Checking GitHub permissions...";
      }
      case "ok": {
        return `This will commit your change to ${source.owner}/${source.repo}@${source.branch}.`;
      }
      case "missing-scopes": {
        return "Your linked GitHub account is missing the \"repo\" and \"workflow\" permissions required to push configuration changes. Reconnect to grant them.";
      }
    }
  })();

  return (
    <ActionDialog
      open={open}
      onClose={() => onSettle(false)}
      title="Push Configuration to GitHub"
      description={description}
      okButton={okButton}
      cancelButton={{
        label: "Cancel",
        onClick: async () => {
          onSettle(false);
        },
      }}
    >
      <Suspense fallback={<GithubPushBodyFallback projectId={projectId} />}>
        <GithubPushBody
          source={source}
          configUpdate={configUpdate}
          projectId={projectId}
          onSettle={onSettle}
          onScopeStatusChange={setScopeStatus}
          handlersRef={handlersRef}
        />
      </Suspense>
    </ActionDialog>
  );
}

function GithubPushBodyFallback({ projectId }: { projectId: string | undefined }) {
  // Static body shown during the initial Suspense — no commit input yet
  // (we don't know whether push is even available), just the unlink hint
  // so the dialog "looks normal except the button is disabled".
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        <em>
          If your configuration is no longer on GitHub, you can unlink it in{" "}
          <Link href={projectSettingsHref(projectId)} className="underline">
            Project Settings
          </Link>.
        </em>
      </p>
    </div>
  );
}

type GithubPushBodyProps = {
  source: GithubPushedSource,
  configUpdate: EnvironmentConfigOverrideOverride | null,
  projectId: string | undefined,
  onSettle: (result: boolean) => void,
  onScopeStatusChange: (status: ScopeCheck["status"]) => void,
  handlersRef: React.MutableRefObject<GithubPushHandlers | null>,
};

function GithubPushBody({
  source,
  configUpdate,
  projectId,
  onSettle,
  onScopeStatusChange,
  handlersRef,
}: GithubPushBodyProps) {
  const user = useDashboardInternalUser();
  const githubAccounts = user.useConnectedAccounts().filter((account) => account.provider === "github");

  // Stable dep for the scope-check effect — re-run only when the set of
  // connections actually changes, not on every parent render.
  const githubAccountsKey = githubAccounts.map((a) => a.providerAccountId).join("|");

  const [scopeCheck, setScopeCheck] = useState<ScopeCheck>(
    githubAccounts.length === 0 ? { status: "no-account" } : { status: "checking" },
  );
  const [commitMessage, setCommitMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const placeholderCommitMessage = "Update Hexclave configuration";

  // Sync our local status string up to the dialog shell so it can pick the
  // right button label / description without itself needing to suspend.
  // `useLayoutEffect` (not `useEffect`) so the shell's "checking" placeholder
  // never reaches the screen for users whose initial state is actually
  // "no-account" — the sync runs before the browser paints the first frame
  // after the Suspense fallback resolves.
  useLayoutEffect(() => {
    onScopeStatusChange(scopeCheck.status);
  }, [scopeCheck.status, onScopeStatusChange]);

  // Probe each connected GitHub account for a token that already covers
  // `repo` + `workflow`. The dashboard user may have multiple GitHub
  // connections; only one needs to carry the elevated scopes. We pre-flight
  // here (rather than on Push click) so the user doesn't waste a typed commit
  // message on a redirect, since `linkConnectedAccount` is a full page nav.
  useEffect(() => {
    if (githubAccounts.length === 0) {
      setScopeCheck({ status: "no-account" });
      return;
    }
    // Mutable holder rather than a `let` so TS sees the reassignment in the
    // cleanup callback as a real write; otherwise its flow analysis narrows
    // the closure read to its initial value and the `cancelled` checks below
    // are flagged as constant-condition errors.
    const cancelToken = { cancelled: false };
    setScopeCheck({ status: "checking" });
    runAsynchronously(async () => {
      for (const account of githubAccounts) {
        let tokenResult;
        try {
          tokenResult = await account.getAccessToken({ scopes: GITHUB_SCOPE_REQUIREMENTS });
        } catch {
          // Transport/cache failures — fall through and try the next account.
          continue;
        }
        if (cancelToken.cancelled) return;
        if (tokenResult.status === "ok") {
          setScopeCheck({ status: "ok", account });
          return;
        }
      }
      if (!cancelToken.cancelled) setScopeCheck({ status: "missing-scopes" });
    });
    return () => {
      cancelToken.cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- githubAccountsKey is the stable identity for githubAccounts
  }, [githubAccountsKey]);

  const githubFetch = useMemo(
    () => (scopeCheck.status === "ok" ? createGithubFetch(scopeCheck.account) : null),
    [scopeCheck],
  );

  const handlePush = useCallback(async (): Promise<"prevent-close" | undefined> => {
    if (configUpdate == null) {
      setErrorMessage("No configuration changes to push.");
      return "prevent-close";
    }
    if (githubFetch == null) {
      setErrorMessage("Connect a GitHub account with the required scopes before pushing changes.");
      return "prevent-close";
    }
    setErrorMessage(null);
    try {
      await pushConfigUpdateToGitHub({
        source,
        configUpdate,
        commitMessage: commitMessage.trim().length > 0 ? commitMessage : placeholderCommitMessage,
        githubFetch,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error pushing to GitHub.";
      captureError("config-update-github-push", {
        projectId,
        owner: source.owner,
        repo: source.repo,
        branch: source.branch,
        configFilePath: source.configFilePath,
        cause: error,
      });
      setErrorMessage(message);
      return "prevent-close";
    }
    onSettle(true);
    return undefined;
  }, [commitMessage, configUpdate, githubFetch, onSettle, projectId, source]);

  const handleConnect = useCallback(async (): Promise<"prevent-close" | undefined> => {
    // Full-page redirect to the OAuth provider. When scopes are missing on
    // an existing connection, `getOrLinkConnectedAccount` still redirects
    // because none of the present tokens satisfies the scope set. Returning
    // `prevent-close` is defensive — in practice the redirect happens first.
    try {
      await user.getOrLinkConnectedAccount("github", { scopes: GITHUB_SCOPE_REQUIREMENTS });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error connecting to GitHub.";
      setErrorMessage(message);
      return "prevent-close";
    }
    return "prevent-close";
  }, [user]);

  // Expose the latest handlers to the dialog shell. A ref (rather than
  // calling up via state) avoids re-rendering the shell on every handler
  // identity change, which would also reset the okButton onClick reference.
  useEffect(() => {
    handlersRef.current = { push: handlePush, connect: handleConnect };
  }, [handlersRef, handlePush, handleConnect]);

  return (
    <div className="space-y-4">
      {scopeCheck.status === "ok" && (
        <div className="space-y-2">
          <label htmlFor="commit-message" className="text-sm font-medium">
            Commit message
          </label>
          <input
            id="commit-message"
            type="text"
            className="w-full px-3 py-2 border rounded-md text-sm bg-background"
            placeholder={placeholderCommitMessage}
            value={commitMessage}
            onChange={(e) => setCommitMessage(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Committing to <code className="text-xs">{source.configFilePath}</code> on{" "}
            <code className="text-xs">{source.branch}</code>.
          </p>
        </div>
      )}
      {errorMessage != null && (
        <p className="text-sm text-destructive">
          {errorMessage}
        </p>
      )}
      <p className="text-sm text-muted-foreground">
        <em>
          If your configuration is no longer on GitHub, you can unlink it in{" "}
          <Link href={projectSettingsHref(projectId)} className="underline">
            Project Settings
          </Link>.
        </em>
      </p>
    </div>
  );
}

async function updateRemoteDevelopmentEnvironmentConfigFile(
  adminApp: StackAdminApp<false>,
  configUpdate: EnvironmentConfigOverrideOverride,
): Promise<"updated" | "redirecting"> {
  try {
    const response = await fetchWithRemoteDevelopmentEnvironmentBrowserSecret("/api/remote-development-environment/config/apply-update", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        project_id: adminApp.projectId,
        config_update: configUpdate,
        wait_for_sync: true,
      }),
      signal: AbortSignal.timeout(130_000),
    });
    if (!response.ok) {
      throw new Error(`Failed to update local development environment config (${response.status}): ${await response.text()}`);
    }
    return "updated";
  } catch (error) {
    if (error instanceof RemoteDevelopmentEnvironmentBrowserSecretRedirectingError) {
      return "redirecting";
    }
    throw error;
  }
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

  return useCallback(async (options: UpdateConfigOptions): Promise<boolean> => {
    const { adminApp, configUpdate, pushable } = options;

    if (getPublicEnvVar("NEXT_PUBLIC_STACK_IS_REMOTE_DEVELOPMENT_ENVIRONMENT") === "true") {
      if (!pushable) {
        throw new HexclaveAssertionError("These settings are read-only in a development environment. Update them in your production deployment instead.");
      }

      if (await updateRemoteDevelopmentEnvironmentConfigFile(adminApp, configUpdate) === "redirecting") {
        return false;
      }
      return true;
    }

    if (pushable) {
      // Show dialog (or save directly if unlinked) based on source type
      return await showPushableDialog(adminApp, configUpdate);
    } else {
      // Update environment config directly
      const project = await adminApp.getProject();
      if (project.isDevelopmentEnvironment) {
        alert("These settings are read-only in a development environment. Update them in your production deployment instead.");
        return false;
      }
      // eslint-disable-next-line no-restricted-syntax -- this is the hook implementation itself
      await project.updateConfig(configUpdate);
      return true;
    }
  }, [showPushableDialog]);
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
