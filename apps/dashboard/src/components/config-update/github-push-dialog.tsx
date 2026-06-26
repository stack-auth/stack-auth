'use client';

import { Link } from "@/components/link";
import { DesignAlert, DesignButton, DesignDialog, DesignDialogClose } from "@/components/design-components";
import { useDashboardInternalUser } from "@/lib/dashboard-user";
import { ArrowsClockwise, GitBranch, GitCommit } from "@phosphor-icons/react";
import type { OAuthConnection, StackAdminApp } from "@hexclave/next";
import type { EnvironmentConfigOverrideOverride } from "@hexclave/shared/dist/config/schema";
import { captureError } from "@hexclave/shared/dist/utils/errors";
import { runAsynchronously } from "@hexclave/shared/dist/utils/promises";
import { GITHUB_SCOPE_REQUIREMENTS } from "@/lib/github-api";
import React, { Suspense, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";

import { AgentDiffViewer, ConfigAgentRunProgressContent } from "./progress-content";
import { ConfigUpdateDialogContext, currentEpochMsFromPerformance, getAdminInterface, type AgentStage, type ConfigAgentRun, type GithubPushedSource } from "./shared";

type GithubPushDialogProps = {
  open: boolean,
  adminApp: StackAdminApp<false> | null,
  source: GithubPushedSource,
  configUpdate: EnvironmentConfigOverrideOverride | null,
  projectId: string | undefined,
  onSettle: (result: boolean) => void,
};

// GitHub push dialog: staged progress while the agent runs, then a diff review
// panel; the user must click "Commit" to push.

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
export function GithubPushDialog({ open, adminApp, source, configUpdate, projectId, onSettle }: GithubPushDialogProps) {
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
            {errorMessage != null && configUpdate != null ? "Retry update" : "Start update"}
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
  dialogContext: React.ContextType<typeof ConfigUpdateDialogContext>,
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
    if (adminInterface == null) {
      onErrorChange("This dashboard build can't push config to GitHub. Please refresh and try again.");
      return;
    }

    onErrorChange(null);
    onDiffChange(null);
    onActivityChange(null);
    onStageChange(null);
    try {
      const tokenResult = await scopeCheck.account.getAccessToken({ scopes: GITHUB_SCOPE_REQUIREMENTS });
      if (tokenResult.status !== "ok") {
        onErrorChange("Could not get a GitHub token with the required permissions. Reconnect your GitHub account and try again.");
        return;
      }

      await adminInterface.applyConfigViaAgent({
        configUpdate,
        githubAccessToken: tokenResult.data.accessToken,
      });

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
        let run: ConfigAgentRun | null;
        try {
          run = await adminInterface.getConfigAgentRun();
        } catch {
          continue;
        }
        // Ignore stale runs from before this one started.
        if (run == null || run.started_at < runStartedAtWallMs - 5000) continue;

        if (run.status === "running") {
          if (run.progress != null) onActivityChange(run.progress);
          if (run.stage != null) onStageChange(run.stage);
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
          onErrorChange(run.error ?? "The config agent failed to apply your change.");
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
        // success: a poll raced a completed commit. Settle so the dashboard refreshes.
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
    if (adminInterface == null) {
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
    if (adminInterface == null) {
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
        onStageChange(null);
        onErrorChange("The sandbox session expired. Please retry the update.");
        return;
      }
      if (result.status === "not-awaiting-review") {
        onPhaseChange("idle");
        onStageChange(null);
        onErrorChange("There is no config diff waiting to commit. Start the update again.");
        return;
      }
      // "committing" — poll until done
      const deadline = performance.now() + 2 * 60_000;
      while (performance.now() < deadline) {
        await new Promise((r) => setTimeout(r, 3000));
        let run: ConfigAgentRun | null;
        try {
          run = await adminInterface.getConfigAgentRun();
        } catch {
          continue;
        }
        if (run == null || run.status === "awaiting_review") continue;
        if (run.status === "success") {
          onPhaseChange("idle");
          onSettle(true);
          return;
        }
        if (run.status === "error") {
          onPhaseChange("idle");
          onStageChange(null);
          onErrorChange(run.error ?? "Failed to commit and push the changes. Please try again.");
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
      onPhaseChange("idle");
      onStageChange(null);
      onErrorChange("Unknown error committing to GitHub.");
    }
  }, [adminApp, commitMessage, onErrorChange, onPhaseChange, onSettle, onStageChange, scopeCheck]);

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
        <DesignAlert variant="error" description={errorMessage} />
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
