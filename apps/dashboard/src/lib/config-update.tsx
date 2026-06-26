'use client';

import { Link } from "@/components/link";
import { ActionDialog } from "@/components/ui/action-dialog";
import { fetchWithRemoteDevelopmentEnvironmentBrowserSecret, RemoteDevelopmentEnvironmentBrowserSecretRedirectingError } from "@/app/remote-development-environment-browser-secret-client";
import { DesignButton, DesignDialog, DesignDialogClose } from "@/components/design-components";
import { useDashboardInternalUser } from "@/lib/dashboard-user";
import { getPublicEnvVar } from "@/lib/env";
import { ArrowsClockwise, GitBranch, GitCommit } from "@phosphor-icons/react";
import type { OAuthConnection, PushedConfigSource, StackAdminApp } from "@hexclave/next";
import type { EnvironmentConfigOverrideOverride } from "@hexclave/shared/dist/config/schema";
import type { HexclaveAdminInterface } from "@hexclave/shared/dist/interface/admin-interface";
import { HexclaveAssertionError, captureError } from "@hexclave/shared/dist/utils/errors";
import { runAsynchronously } from "@hexclave/shared/dist/utils/promises";
import React, { createContext, Suspense, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { FileDiffProps } from "@pierre/diffs/react";
import type { FileDiffMetadata } from "@pierre/diffs";

import { GITHUB_SCOPE_REQUIREMENTS } from "./github-api";

/**
 * Reaches the admin app's underlying `HexclaveAdminInterface`, which carries the
 * config-agent endpoints (`applyConfigViaAgent`, `cancelConfigAgentRun`,
 * `getPushedConfigSource`) we call directly — rather than via generated app
 * methods — to keep this feature self-contained. `_interface` is a protected
 * member, so we read it reflectively (the same pattern the SDK's own cross-domain
 * tests use). Returns `null` if the app doesn't expose one.
 *
 * NOTE: these methods exist on the type, but the installed `@hexclave/next` build
 * could predate them, so callers still runtime-check the specific method before
 * use and degrade gracefully ("refresh and try again").
 */
export function getAdminInterface(adminApp: StackAdminApp<false> | null | undefined): HexclaveAdminInterface | null {
  if (adminApp == null) return null;
  // `Reflect.get` returns `any`; the typed annotation documents the contract
  // without an explicit cast (and without an `instanceof`, which is unreliable
  // across package-boundary copies of the class).
  const iface: HexclaveAdminInterface | undefined = Reflect.get(adminApp, "_interface");
  return iface ?? null;
}

type GithubPushedSource = Extract<PushedConfigSource, { type: "pushed-from-github" }>;

export type ConfigAgentRunStatus = "running" | "awaiting_review" | "success" | "no-change" | "error" | "cancelled";
export type AgentStage = "initializing_sandbox" | "cloning_repo" | "agent_making_changes" | "awaiting_review";

export type GithubPushedSourceWithAgentRun = GithubPushedSource & {
  agent_run?: {
    status: ConfigAgentRunStatus,
    started_at: number,
    finished_at?: number,
    progress?: string,
    sandbox_id?: string,
    commit_url?: string,
    new_commit_hash?: string,
    error?: string,
    stage?: AgentStage,
    diff?: string,
  },
};

function isAgentStage(value: unknown): value is AgentStage {
  return value === "initializing_sandbox" || value === "cloning_repo" || value === "agent_making_changes" || value === "awaiting_review";
}

export function isGithubPushedSourceWithAgentRun(source: unknown): source is GithubPushedSourceWithAgentRun {
  return typeof source === "object" && source != null && "type" in source && source.type === "pushed-from-github";
}

function currentEpochMsFromPerformance(): number {
  return performance.timeOrigin + performance.now();
}

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
  // True while THIS tab's push dialog is actively managing a started run, so the
  // page-load watcher (ConfigAgentRunWatcher) doesn't also pop its own modal for
  // the same run. The watcher owns the modal only for runs this tab didn't start
  // (other tabs / reloads).
  githubRunActive: boolean,
  setGithubRunActive: (active: boolean) => void,
} | null>(null);

/** Read-only accessor for the watcher (mounted below this provider). */
export function useGithubRunActive(): boolean {
  return useContext(ConfigUpdateDialogContext)?.githubRunActive ?? false;
}

type StepDef = { key: AgentStage, label: string, subLabel?: string };
const STAGE_STEPS: StepDef[] = [
  { key: "initializing_sandbox", label: "Initializing sandbox" },
  { key: "cloning_repo", label: "Cloning repo" },
  { key: "agent_making_changes", label: "Agent making changes", subLabel: "Editing config file" },
  { key: "awaiting_review", label: "Ready to review" },
];

function stageIndex(stage: AgentStage | null | undefined): number {
  if (stage == null) return -1;
  return STAGE_STEPS.findIndex((s) => s.key === stage);
}

/**
 * A compact stage tracker shown while the agent is running. Each step shows
 * elapsed seconds and a live activity sub-label for the active step.
 */
export function AgentStageProgress({
  stage,
  startedAt,
  activity,
}: {
  stage: AgentStage | null | undefined,
  /** Unix ms timestamp of when the run started (from agent_run.started_at). */
  startedAt: number,
  activity?: string | null,
}) {
  const [elapsedMs, setElapsedMs] = useState(0);
  useEffect(() => {
    const performanceStartedAt = performance.now();
    const t = setInterval(() => setElapsedMs(performance.now() - performanceStartedAt), 1000);
    return () => clearInterval(t);
  }, []);

  const activeIdx = stageIndex(stage);
  // Server-side run timestamps are wall-clock epoch values. Once mounted, keep
  // the visible elapsed counter on a monotonic clock so local clock jumps don't
  // make the progress UI move backwards.
  const initialElapsedMs = Math.max(0, currentEpochMsFromPerformance() - startedAt);
  const overallElapsed = Math.max(0, Math.floor((initialElapsedMs + elapsedMs) / 1000));

  return (
    <div className="space-y-2">
      {STAGE_STEPS.map((step, idx) => {
        const isDone = idx < activeIdx;
        const isActive = idx === activeIdx;
        const isPending = idx > activeIdx;

        return (
          <div key={step.key} className="flex items-start gap-3">
            {/* Step indicator */}
            <div className={`mt-0.5 h-5 w-5 rounded-full flex items-center justify-center shrink-0 transition-colors duration-150 ${
              isDone
                ? "bg-primary/15 text-primary"
                : isActive
                  ? "bg-primary text-primary-foreground"
                  : "bg-foreground/[0.06] text-muted-foreground"
            }`}>
              {isDone ? (
                <svg className="h-3 w-3" viewBox="0 0 12 12" fill="none">
                  <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              ) : (
                <span className={`text-[9px] font-semibold leading-none ${isPending ? "opacity-40" : ""}`}>{idx + 1}</span>
              )}
            </div>

            {/* Step label */}
            <div className="flex-1 min-w-0 pt-0.5">
              <div className={`text-xs font-medium leading-snug flex items-center gap-2 ${
                isPending ? "text-muted-foreground opacity-50" : "text-foreground"
              }`}>
                <span>{step.label}</span>
                {isActive && (
                  <span className="text-muted-foreground font-normal tabular-nums">
                    {overallElapsed}s
                  </span>
                )}
              </div>
              {isActive && activity != null && activity.trim().length > 0 && (
                <div className="mt-1 font-mono text-[11px] text-muted-foreground leading-relaxed truncate">
                  <span className="text-primary mr-1.5">▸</span>
                  {activity.split("\n").filter((l) => l.trim()).at(-1)}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function ConfigAgentRunProgressContent({
  isCancelling,
  stage,
  startedAt,
  activity,
  errorMessage,
}: {
  isCancelling: boolean,
  stage: AgentStage | null | undefined,
  startedAt: number,
  activity?: string | null,
  errorMessage?: string | null,
}) {
  return (
    <div className="space-y-3">
      {isCancelling ? (
        <p className="text-sm text-muted-foreground">Cancelling the update and stopping the agent…</p>
      ) : (
        <AgentStageProgress stage={stage} startedAt={startedAt} activity={activity} />
      )}
      {errorMessage != null && (
        <p className="text-sm text-destructive">{errorMessage}</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Diff viewer
// ---------------------------------------------------------------------------

/**
 * Lazy-loaded diff viewer. We parse the sandbox's full `git diff` into file
 * diffs, then render each file with Pierre's React renderer. `PatchDiff` only
 * accepts a single-file patch, while the config agent may legitimately edit
 * helpers/imported config files too.
 */
export function AgentDiffViewer({ diff }: { diff: string }) {
  const [renderer, setRenderer] = useState<{
    FileDiff: React.ComponentType<FileDiffProps<undefined>>,
    files: FileDiffMetadata[],
  } | null>(null);

  useEffect(() => {
    const cancelToken = { cancelled: false };
    runAsynchronously(async () => {
      try {
        const [{ parsePatchFiles }, reactMod] = await Promise.all([
          import("@pierre/diffs"),
          import("@pierre/diffs/react"),
        ]);
        if (cancelToken.cancelled) return;
        const files = parsePatchFiles(diff, "config-agent-review", true).flatMap((patch) => patch.files);
        if (files.length === 0) return;
        setRenderer({ FileDiff: reactMod.FileDiff, files });
      } catch {
        // Module failed to load — fall back to raw diff text
      }
    });
    return () => {
      cancelToken.cancelled = true;
    };
  }, [diff]);

  if (renderer != null) {
    const { FileDiff } = renderer;
    return (
      <div className="max-h-[60vh] space-y-3 overflow-auto rounded-xl border border-border/30 bg-background/60 p-2">
        {renderer.files.map((fileDiff, index) => (
          <FileDiff
            key={fileDiff.cacheKey ?? `${fileDiff.name}-${index}`}
            fileDiff={fileDiff}
            options={{
              theme: { dark: "github-dark", light: "github-light" },
              diffStyle: "unified",
              hunkSeparators: "line-info-basic",
              overflow: "scroll",
            }}
          />
        ))}
      </div>
    );
  }

  // Fallback: raw monospace diff
  return (
    <pre className="max-h-96 overflow-auto rounded-xl border border-border/30 bg-muted/20 p-4 font-mono text-[11px] text-foreground leading-relaxed whitespace-pre">
      {diff}
    </pre>
  );
}

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
  const [githubRunActive, setGithubRunActive] = useState(false);

  const showPushableDialog = useCallback(async (adminApp: StackAdminApp<false>, configUpdate: EnvironmentConfigOverrideOverride): Promise<boolean> => {
    // Fetch the source first
    const project = await adminApp.getProject();
    const source = await project.getPushedConfigSource();

    // If a config-agent run is already in flight for this project, don't open the
    // push dialog at all — the page-load watcher already shows a non-dismissible
    // progress modal and the backend would reject a second run anyway. The mapped
    // `PushedConfigSource` drops `agent_run`, so read the raw interface source.
    if (source.type === "pushed-from-github") {
      const iface = getAdminInterface(adminApp);
      if (iface != null && typeof iface.getPushedConfigSource === "function") {
        let rawSource: unknown = null;
        try {
          rawSource = await iface.getPushedConfigSource();
        } catch {
          // transient — fall through to the normal dialog rather than blocking
        }
        if (isGithubPushedSourceWithAgentRun(rawSource) && rawSource.agent_run?.status === "running") {
          return false;
        }
      }
    }

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
            adminApp={dialogState.adminApp}
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
    <ConfigUpdateDialogContext.Provider value={{ showPushableDialog, githubRunActive, setGithubRunActive }}>
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
  adminApp: StackAdminApp<false> | null,
  source: GithubPushedSource,
  configUpdate: EnvironmentConfigOverrideOverride | null,
  projectId: string | undefined,
  onSettle: (result: boolean) => void,
};

/**
 * The new GitHub push dialog: shows a staged progress bar while the agent
 * runs, then a diff review panel once the agent is done. The user must
 * explicitly click "Commit" to push. No auto-commit.
 */

type ScopeCheck =
  | { status: "no-account" }
  | { status: "checking" }
  | { status: "ok", account: OAuthConnection }
  | { status: "missing-scopes" };

// "idle": waiting for user to start.
// "running": agent is in flight (non-dismissible; Cancel stops the sandbox).
// "cancelling": user clicked Cancel, waiting for terminal status.
// "awaiting_review": agent done, diff loaded, waiting for user to commit.
// "committing": user clicked Commit, pushing to GitHub.
type DialogPhase = "idle" | "running" | "cancelling" | "awaiting_review" | "committing";

function projectSettingsHref(projectId: string | undefined): string {
  return `/projects/${projectId}/project-settings`;
}

/**
 * Outer shell: renders the DesignDialog synchronously; the Suspense-suspending
 * body (scope check) is isolated inside.
 */
function GithubPushDialog({ open, adminApp, source, configUpdate, projectId, onSettle }: GithubPushDialogProps) {
  const [scopeStatus, setScopeStatus] = useState<ScopeCheck["status"]>("checking");
  const [phase, setPhase] = useState<DialogPhase>("idle");
  const [stage, setStage] = useState<AgentStage | null>(null);
  const [startedAt, setStartedAt] = useState<number>(0);
  const [activity, setActivity] = useState<string | null>(null);
  const [diff, setDiff] = useState<string | null>(null);
  const [commitMessage, setCommitMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Expose imperative handles from the body (which can suspend) to the outer shell.
  const handlersRef = useRef<{
    push: () => Promise<void>,
    connect: () => Promise<void>,
    cancel: () => Promise<void>,
    commit: () => Promise<void>,
  } | null>(null);

  const dialogContext = useContext(ConfigUpdateDialogContext);
  const isNonDismissible = phase === "running" || phase === "cancelling" || phase === "committing";

  const description = (() => {
    switch (phase) {
      case "idle": {
        switch (scopeStatus) {
          case "no-account": { return "Connect a GitHub account to push configuration changes to this repository."; }
          case "checking": { return "Checking GitHub permissions…"; }
          case "ok": { return `This will apply your change to ${source.owner}/${source.repo}@${source.branch}.`; }
          case "missing-scopes": { return `Your linked GitHub account is missing the "repo" and "workflow" permissions. Reconnect to grant them.`; }
        }
        break;
      }
      case "running":
      case "cancelling": {
        return `Applying your change in a sandbox — ${source.owner}/${source.repo}@${source.branch}`;
      }
      case "awaiting_review": {
        return `Review the changes before committing to ${source.branch}.`;
      }
      case "committing": {
        return `Pushing to ${source.owner}/${source.repo}@${source.branch}…`;
      }
    }
  })();

  // Footer buttons
  const footer = (() => {
    if (phase === "running") {
      return (
        <div className="flex items-center gap-2">
          <DesignButton
            variant="outline"
            size="sm"
            onClick={async () => { await handlersRef.current?.cancel(); }}
          >
            Cancel
          </DesignButton>
        </div>
      );
    }
    if (phase === "cancelling") {
      return (
        <DesignButton variant="outline" size="sm" disabled>
          Cancelling…
        </DesignButton>
      );
    }
    if (phase === "awaiting_review") {
      return (
        <div className="flex items-center gap-2 w-full">
          <DesignButton
            variant="outline"
            size="sm"
            onClick={async () => { await handlersRef.current?.cancel(); }}
          >
            Discard
          </DesignButton>
          <div className="flex-1" />
          <div className="flex items-center gap-2">
            <label htmlFor="push-commit-msg" className="text-xs text-muted-foreground whitespace-nowrap">
              Commit message
            </label>
            <input
              id="push-commit-msg"
              type="text"
              className="h-8 rounded-lg border border-border/50 bg-background px-3 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/40 transition-colors duration-150 hover:transition-none w-52"
              placeholder="chore(hexclave): update config from dashboard"
              value={commitMessage}
              onChange={(e) => setCommitMessage(e.target.value)}
            />
            <DesignButton
              size="sm"
              onClick={async () => { await handlersRef.current?.commit(); }}
            >
              <GitCommit className="h-3.5 w-3.5 mr-1.5" />
              Commit
            </DesignButton>
          </div>
        </div>
      );
    }
    if (phase === "committing") {
      return (
        <div className="flex items-center gap-2">
          <DesignButton size="sm" disabled loading>
            Committing…
          </DesignButton>
        </div>
      );
    }
    // idle
    return (
      <div className="flex items-center gap-2">
        <DesignDialogClose asChild>
          <DesignButton variant="outline" size="sm" onClick={async () => { onSettle(false); }}>
            Cancel
          </DesignButton>
        </DesignDialogClose>
        {scopeStatus === "no-account" || scopeStatus === "missing-scopes" ? (
          <DesignButton size="sm" onClick={async () => { await handlersRef.current?.connect(); }}>
            {scopeStatus === "no-account" ? "Connect with GitHub" : "Reconnect with GitHub"}
          </DesignButton>
        ) : (
          <DesignButton
            size="sm"
            onClick={async () => { await handlersRef.current?.push(); }}
            disabled={scopeStatus === "checking"}
            loading={scopeStatus === "checking"}
          >
            <ArrowsClockwise className="h-3.5 w-3.5 mr-1.5" />
            Start update
          </DesignButton>
        )}
      </div>
    );
  })();

  // Dialog size grows when showing the diff
  const dialogSize = phase === "awaiting_review" ? "3xl" : "lg";

  return (
    <DesignDialog
      open={open}
      onOpenChange={(o) => {
        if (o || isNonDismissible) return;
        onSettle(false);
      }}
      size={dialogSize}
      icon={GitBranch}
      title="Push configuration to GitHub"
      description={description}
      hideTopCloseButton={isNonDismissible}
      footer={footer}
      contentProps={{ onPointerDownOutside: isNonDismissible ? (e) => e.preventDefault() : undefined, onEscapeKeyDown: isNonDismissible ? (e) => e.preventDefault() : undefined }}
    >
      <Suspense fallback={<div className="py-2 text-sm text-muted-foreground">Loading…</div>}>
        <GithubPushBody
          adminApp={adminApp}
          source={source}
          configUpdate={configUpdate}
          projectId={projectId}
          onSettle={onSettle}
          phase={phase}
          stage={stage}
          startedAt={startedAt}
          activity={activity}
          diff={diff}
          commitMessage={commitMessage}
          errorMessage={errorMessage}
          onScopeStatusChange={setScopeStatus}
          onPhaseChange={setPhase}
          onStageChange={setStage}
          onStartedAtChange={setStartedAt}
          onActivityChange={setActivity}
          onDiffChange={setDiff}
          onErrorChange={setErrorMessage}
          handlersRef={handlersRef}
          dialogContext={dialogContext}
        />
      </Suspense>
    </DesignDialog>
  );
}

type GithubPushBodyProps = {
  adminApp: StackAdminApp<false> | null,
  source: GithubPushedSource,
  configUpdate: EnvironmentConfigOverrideOverride | null,
  projectId: string | undefined,
  onSettle: (result: boolean) => void,
  phase: DialogPhase,
  stage: AgentStage | null,
  startedAt: number,
  activity: string | null,
  diff: string | null,
  commitMessage: string,
  errorMessage: string | null,
  onScopeStatusChange: (s: ScopeCheck["status"]) => void,
  onPhaseChange: (p: DialogPhase) => void,
  onStageChange: (s: AgentStage | null) => void,
  onStartedAtChange: (ms: number) => void,
  onActivityChange: (a: string | null) => void,
  onDiffChange: (d: string | null) => void,
  onErrorChange: (e: string | null) => void,
  handlersRef: React.MutableRefObject<{
    push: () => Promise<void>,
    connect: () => Promise<void>,
    cancel: () => Promise<void>,
    commit: () => Promise<void>,
  } | null>,
  dialogContext: { setGithubRunActive: (v: boolean) => void } | null,
};

function GithubPushBody({
  adminApp,
  source,
  configUpdate,
  projectId,
  onSettle,
  phase,
  stage,
  startedAt,
  activity,
  diff,
  commitMessage,
  errorMessage,
  onScopeStatusChange,
  onPhaseChange,
  onStageChange,
  onStartedAtChange,
  onActivityChange,
  onDiffChange,
  onErrorChange,
  handlersRef,
  dialogContext,
}: GithubPushBodyProps) {
  const user = useDashboardInternalUser();
  const githubAccounts = user.useConnectedAccounts().filter((account) => account.provider === "github");
  const githubAccountsKey = githubAccounts.map((a) => a.providerAccountId).join("|");

  const [scopeCheck, setScopeCheck] = useState<ScopeCheck>(
    githubAccounts.length === 0 ? { status: "no-account" } : { status: "checking" },
  );

  const placeholderCommitMessage = "chore(hexclave): update config from dashboard";

  useLayoutEffect(() => {
    onScopeStatusChange(scopeCheck.status);
  }, [scopeCheck.status, onScopeStatusChange]);

  useEffect(() => {
    if (githubAccounts.length === 0) {
      setScopeCheck({ status: "no-account" });
      return;
    }
    const cancelToken = { cancelled: false };
    setScopeCheck({ status: "checking" });
    runAsynchronously(async () => {
      for (const account of githubAccounts) {
        let tokenResult;
        try {
          tokenResult = await account.getAccessToken({ scopes: GITHUB_SCOPE_REQUIREMENTS });
        } catch {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- githubAccountsKey
  }, [githubAccountsKey]);

  const handlePush = useCallback(async () => {
    if (configUpdate == null) {
      onErrorChange("No configuration changes to push.");
      return;
    }
    if (scopeCheck.status !== "ok") {
      onErrorChange("Connect a GitHub account with the required scopes before pushing changes.");
      return;
    }
    const adminInterface = getAdminInterface(adminApp);
    if (adminInterface == null || typeof adminInterface.applyConfigViaAgent !== "function") {
      onErrorChange("This dashboard build can't push config to GitHub. Please refresh and try again.");
      return;
    }

    onErrorChange(null);
    try {
      const tokenResult = await scopeCheck.account.getAccessToken({ scopes: GITHUB_SCOPE_REQUIREMENTS });
      if (tokenResult.status !== "ok") {
        onErrorChange("Could not get a GitHub token with the required permissions. Reconnect your GitHub account and try again.");
        return;
      }

      const start = await adminInterface.applyConfigViaAgent({
        configUpdate,
        // Pass a placeholder; the real commit message is gathered at review time.
        commitMessage: placeholderCommitMessage,
        githubAccessToken: tokenResult.data.accessToken,
      });
      if (start.status === "already-running") {
        onErrorChange("Another configuration update is already running for this project. Wait for it to finish, then try again.");
        return;
      }

      const runStartedAtWallMs = currentEpochMsFromPerformance();
      const runStartedAtMonotonicMs = performance.now();
      onStartedAtChange(runStartedAtWallMs);
      dialogContext?.setGithubRunActive(true);
      onPhaseChange("running");
      onActivityChange(null);
      onStageChange("initializing_sandbox");

      // Poll until the run transitions out of "running" (either to
      // "awaiting_review", a terminal status, or times out).
      const deadline = performance.now() + 8 * 60_000;
      while (performance.now() < deadline) {
        await new Promise((r) => setTimeout(r, 3000));
        let latest: unknown;
        try {
          latest = await adminInterface.getPushedConfigSource();
        } catch {
          continue;
        }
        const run = isGithubPushedSourceWithAgentRun(latest) ? latest.agent_run : null;
        // Ignore stale runs from before this one started.
        if (run == null || (typeof run.started_at === "number" && run.started_at < runStartedAtWallMs - 5000)) continue;

        if (run.status === "running") {
          if (typeof run.progress === "string") onActivityChange(run.progress);
          if (isAgentStage(run.stage)) onStageChange(run.stage);
          continue;
        }

        // Non-running status: transition.
        dialogContext?.setGithubRunActive(false);

        if (run.status === "awaiting_review") {
          onPhaseChange("awaiting_review");
          onStageChange("awaiting_review");
          if (typeof run.diff === "string") onDiffChange(run.diff);
          return;
        }
        if (run.status === "error") {
          onPhaseChange("idle");
          onStageChange(null);
          onErrorChange("The config agent failed to apply your change.");
          return;
        }
        if (run.status === "cancelled") {
          onPhaseChange("idle");
          onStageChange(null);
          onSettle(false);
          return;
        }
        if (run.status === "no-change") {
          onPhaseChange("idle");
          onStageChange(null);
          onErrorChange("The config agent finished without producing a diff. No commit was created; try the update again.");
          return;
        }
        // success is only expected from older auto-commit flows or a race with
        // a completed commit. Settle so the dashboard can refresh its local state.
        onPhaseChange("idle");
        onStageChange(null);
        onSettle(true);
        return;
      }

      dialogContext?.setGithubRunActive(false);
      onPhaseChange("idle");
      onStageChange(null);
      const elapsedSeconds = Math.floor((performance.now() - runStartedAtMonotonicMs) / 1000);
      onErrorChange(`Timed out after ${elapsedSeconds}s waiting for the config agent. Your change may still be in progress; check the linked repository.`);
    } catch (error) {
      captureError("config-update-github-agent", {
        projectId,
        owner: source.owner,
        repo: source.repo,
        branch: source.branch,
        configFilePath: source.configFilePath,
        cause: error,
      });
      dialogContext?.setGithubRunActive(false);
      onPhaseChange("idle");
      onStageChange(null);
      onErrorChange("Unknown error pushing to GitHub.");
    }
  }, [adminApp, configUpdate, dialogContext, onActivityChange, onDiffChange, onErrorChange, onPhaseChange, onSettle, onStageChange, onStartedAtChange, projectId, scopeCheck, source]);

  const handleCancel = useCallback(async () => {
    const adminInterface = getAdminInterface(adminApp);
    if (adminInterface == null || typeof adminInterface.cancelConfigAgentRun !== "function") {
      onErrorChange("This dashboard build can't cancel a config run. Please refresh and try again.");
      return;
    }
    onPhaseChange("cancelling");
    try {
      await adminInterface.cancelConfigAgentRun();
    } catch (error) {
      captureError("config-update-github-cancel", error);
    }
    // The poll loop in handlePush will observe the terminal `cancelled` status and settle.
  }, [adminApp, onErrorChange, onPhaseChange]);

  const handleCommit = useCallback(async () => {
    if (scopeCheck.status !== "ok") {
      onErrorChange("GitHub account not connected. Please reconnect and try again.");
      return;
    }
    const adminInterface = getAdminInterface(adminApp);
    if (adminInterface == null || typeof adminInterface.commitConfigAgentRun !== "function") {
      onErrorChange("This dashboard build can't commit. Please refresh and try again.");
      return;
    }
    onPhaseChange("committing");
    onErrorChange(null);
    try {
      const tokenResult = await scopeCheck.account.getAccessToken({ scopes: GITHUB_SCOPE_REQUIREMENTS });
      if (tokenResult.status !== "ok") {
        onPhaseChange("awaiting_review");
        onErrorChange("Could not get a GitHub token. Reconnect your GitHub account and try again.");
        return;
      }
      const result = await adminInterface.commitConfigAgentRun({
        githubAccessToken: tokenResult.data.accessToken,
        commitMessage: commitMessage.trim().length > 0 ? commitMessage : undefined,
      });
      if (result.status === "sandbox-expired") {
        onPhaseChange("idle");
        onErrorChange("The sandbox session expired. Please retry the update.");
        return;
      }
      if (result.status === "not-awaiting-review") {
        onPhaseChange("idle");
        onErrorChange("There is no config diff waiting to commit. Start the update again.");
        return;
      }
      // "committing" — poll until done
      const adminInterface2 = adminInterface;
      const deadline = performance.now() + 2 * 60_000;
      while (performance.now() < deadline) {
        await new Promise((r) => setTimeout(r, 3000));
        let latest: unknown;
        try {
          latest = await adminInterface2.getPushedConfigSource();
        } catch {
          continue;
        }
        const run = isGithubPushedSourceWithAgentRun(latest) ? latest.agent_run : null;
        if (run == null || run.status === "awaiting_review") continue;
        if (run.status === "success") {
          onPhaseChange("idle");
          onSettle(true);
          return;
        }
        if (run.status === "error") {
          onPhaseChange("awaiting_review");
          onErrorChange("Failed to commit and push the changes. Please try again.");
          return;
        }
        if (run.status === "cancelled") {
          onPhaseChange("idle");
          onSettle(false);
          return;
        }
      }
      onPhaseChange("awaiting_review");
      onErrorChange("Timed out waiting for the commit. Check the repository for status.");
    } catch (error) {
      captureError("config-update-github-commit", error);
      onPhaseChange("awaiting_review");
      onErrorChange("Unknown error committing to GitHub.");
    }
  }, [adminApp, commitMessage, onErrorChange, onPhaseChange, onSettle, scopeCheck]);

  const handleConnect = useCallback(async () => {
    try {
      await user.getOrLinkConnectedAccount("github", { scopes: GITHUB_SCOPE_REQUIREMENTS });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error connecting to GitHub.";
      onErrorChange(message);
    }
  }, [onErrorChange, user]);

  useEffect(() => {
    handlersRef.current = { push: handlePush, connect: handleConnect, cancel: handleCancel, commit: handleCommit };
  }, [handlersRef, handlePush, handleConnect, handleCancel, handleCommit]);

  return (
    <div className="space-y-4">
      {/* Stage progress bar — shown while running */}
      {(phase === "running" || phase === "cancelling") && (
        <ConfigAgentRunProgressContent
          isCancelling={phase === "cancelling"}
          stage={stage}
          startedAt={startedAt}
          activity={activity}
          errorMessage={errorMessage}
        />
      )}

      {/* Diff viewer — shown when awaiting review */}
      {phase === "awaiting_review" && diff != null && diff.trim().length > 0 && (
        <AgentDiffViewer diff={diff} />
      )}

      {/* Error */}
      {phase !== "running" && phase !== "cancelling" && errorMessage != null && (
        <p className="rounded-lg bg-destructive/8 px-3 py-2 text-sm text-destructive">{errorMessage}</p>
      )}

      {/* Unlink hint — shown in idle state */}
      {phase === "idle" && (
        <p className="text-xs text-muted-foreground">
          If your configuration is no longer on GitHub, you can{" "}
          <Link href={projectSettingsHref(projectId)} className="underline">
            unlink it in Project Settings
          </Link>.
        </p>
      )}
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
