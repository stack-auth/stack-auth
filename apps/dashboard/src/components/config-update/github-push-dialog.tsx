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
import React, { Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { AgentDiffViewer, ConfigAgentPreviewProgress } from "./progress-content";
import { currentEpochMsFromPerformance, getAdminInterface, type AgentStage, type ConfigAgentRun, type GithubPushedSource } from "./shared";

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

// "check": verifying the GitHub account is linked with valid scopes; when the
//   check passes the run starts automatically. Also the resting state after a
//   failed run (shows the error + a manual retry).
//
// The remaining phases all render the SAME commit-form layout (commit message
// input + a "Commit preview" box); only the preview box content and the footer
// buttons differ, so the UI doesn't jump between running and review:
// "running": agent is in flight — preview box shows the live loader; Commit is
//   disabled; Cancel stops the sandbox. The commit message can be drafted here.
// "cancelling": user clicked Cancel, waiting for terminal status.
// "awaiting_review": agent done, diff loaded into the preview box; Commit enabled.
// "committing": user clicked Commit, pushing to GitHub.
type DialogPhase = "check" | "running" | "cancelling" | "awaiting_review" | "committing";

// Phases that share the commit-form layout (everything except the scope check).
function isCommitFormPhase(phase: DialogPhase): boolean {
  return phase === "running" || phase === "cancelling" || phase === "awaiting_review" || phase === "committing";
}

function projectSettingsHref(projectId: string | undefined): string {
  return `/projects/${projectId}/project-settings`;
}

/**
 * Outer shell: renders the DesignDialog synchronously; the Suspense-suspending
 * body (scope check) is isolated inside.
 */
export function GithubPushDialog({ open, adminApp, source, configUpdate, projectId, onSettle }: GithubPushDialogProps) {
  const [scopeStatus, setScopeStatus] = useState<ScopeCheck["status"]>("checking");
  const [phase, setPhase] = useState<DialogPhase>("check");
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

  const isNonDismissible = phase === "running" || phase === "cancelling" || phase === "committing";

  // The commit-form phases explain themselves in the body (so the header stays
  // identical across running/review); only the scope-check phase needs a header
  // description.
  const description = (() => {
    if (phase !== "check") return undefined;
    switch (scopeStatus) {
      case "no-account": { return "Connect a GitHub account to push configuration changes to this repository."; }
      case "checking": { return "Checking GitHub permissions…"; }
      case "ok": { return `This will apply your change to ${source.owner}/${source.repo}@${source.branch}.`; }
      case "missing-scopes": { return `Your linked GitHub account is missing the "repo" and "workflow" permissions. Reconnect to grant them.`; }
    }
  })();

  // Footer buttons
  const footer = (() => {
    // Shared commit-form footer: Cancel on the left, status + Commit on the right.
    // The only per-phase differences are button enabled/loading state and the
    // "Waiting for preview…" hint, so running and review keep the same shape.
    if (isCommitFormPhase(phase)) {
      const canCommit = phase === "awaiting_review";
      return (
        <div className="flex items-center gap-3 w-full">
          <DesignButton
            variant="outline"
            size="sm"
            disabled={phase === "cancelling" || phase === "committing"}
            onClick={async () => { await handlersRef.current?.cancel(); }}
          >
            {phase === "cancelling" ? "Cancelling…" : "Cancel"}
          </DesignButton>
          <div className="flex-1" />
          {phase === "running" && (
            <span className="text-xs text-muted-foreground whitespace-nowrap">Waiting for preview…</span>
          )}
          <DesignButton
            size="sm"
            disabled={!canCommit}
            loading={phase === "committing"}
            onClick={async () => { await handlersRef.current?.commit(); }}
          >
            {phase !== "committing" && <GitCommit className="h-3.5 w-3.5 mr-1.5" />}
            {phase === "committing" ? "Committing…" : "Commit"}
          </DesignButton>
        </div>
      );
    }
    // check
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
        ) : errorMessage != null && configUpdate != null ? (
          <DesignButton size="sm" onClick={async () => { await handlersRef.current?.push(); }}>
            <ArrowsClockwise className="h-3.5 w-3.5 mr-1.5" />
            Retry update
          </DesignButton>
        ) : (
          // Scope check passing (or still checking) auto-starts the run; show a
          // non-interactive loading affordance until the phase flips to "running".
          <DesignButton size="sm" disabled loading>
            {scopeStatus === "checking" ? "Checking…" : "Starting…"}
          </DesignButton>
        )}
      </div>
    );
  })();

  // The whole commit form (running → review) uses one width so the dialog never
  // resizes when the preview box swaps the loader out for the diff.
  const dialogSize = isCommitFormPhase(phase) ? "3xl" : "lg";

  return (
    <DesignDialog
      open={open}
      onOpenChange={(o) => {
        if (o || isNonDismissible) return;
        onSettle(false);
      }}
      size={dialogSize}
      icon={GitBranch}
      title="Push configuration"
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
          onCommitMessageChange={setCommitMessage}
          onScopeStatusChange={setScopeStatus}
          onPhaseChange={setPhase}
          onStageChange={setStage}
          onStartedAtChange={setStartedAt}
          onActivityChange={setActivity}
          onDiffChange={setDiff}
          onErrorChange={setErrorMessage}
          handlersRef={handlersRef}
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
  onCommitMessageChange: (m: string) => void,
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
  onCommitMessageChange,
  onScopeStatusChange,
  onPhaseChange,
  onStageChange,
  onStartedAtChange,
  onActivityChange,
  onDiffChange,
  onErrorChange,
  handlersRef,
}: GithubPushBodyProps) {
  const user = useDashboardInternalUser();
  const githubAccounts = user.useConnectedAccounts().filter((account) => account.provider === "github");
  const githubAccountsKey = githubAccounts.map((a) => a.providerAccountId).join("|");

  const [scopeCheck, setScopeCheck] = useState<ScopeCheck>(
    githubAccounts.length === 0 ? { status: "no-account" } : { status: "checking" },
  );

  // Id of the run this dialog started, returned by applyConfigViaAgent. Runs are
  // independent rows, so we poll/cancel/commit THIS run by id rather than "the"
  // run on the branch (another tab may be running its own at the same time).
  const runIdRef = useRef<string | null>(null);

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

      const started = await adminInterface.applyConfigViaAgent({
        configUpdate,
        githubAccessToken: tokenResult.data.accessToken,
      });
      const runId = started.id;
      runIdRef.current = runId;

      const runStartedAtWallMs = currentEpochMsFromPerformance();
      const runStartedAtMonotonicMs = performance.now();
      onStartedAtChange(runStartedAtWallMs);
      onPhaseChange("running");
      onActivityChange(null);
      onStageChange("initializing_sandbox");

      // Poll OUR run by id until it leaves "running" (to "awaiting_review", a
      // terminal status, or timeout). No stale-filtering needed — the id pins
      // exactly this run, independent of any concurrent run on the same branch.
      const deadline = performance.now() + 8 * 60_000;
      while (performance.now() < deadline) {
        await new Promise((r) => setTimeout(r, 3000));
        let run: ConfigAgentRun | null;
        try {
          run = await adminInterface.getConfigAgentRun(runId);
        } catch {
          continue;
        }
        if (run == null) continue;

        if (run.status === "running") {
          if (run.progress != null) onActivityChange(run.progress);
          if (run.stage != null) onStageChange(run.stage);
          continue;
        }

        // Non-running status: transition.
        if (run.status === "awaiting_review") {
          onPhaseChange("awaiting_review");
          onStageChange("awaiting_review");
          if (typeof run.diff === "string") onDiffChange(run.diff);
          return;
        }
        if (run.status === "error") {
          onPhaseChange("check");
          onStageChange(null);
          onErrorChange(run.error ?? "The config agent failed to apply your change.");
          return;
        }
        if (run.status === "cancelled") {
          onPhaseChange("check");
          onStageChange(null);
          onSettle(false);
          return;
        }
        if (run.status === "no-change") {
          onPhaseChange("check");
          onStageChange(null);
          onErrorChange("The config agent finished without producing a diff. No commit was created; try the update again.");
          return;
        }
        // success: a poll raced a completed commit. Settle so the dashboard refreshes.
        onPhaseChange("check");
        onStageChange(null);
        onSettle(true);
        return;
      }

      onPhaseChange("check");
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
      onPhaseChange("check");
      onStageChange(null);
      onErrorChange("Unknown error pushing to GitHub.");
    }
  }, [adminApp, configUpdate, onActivityChange, onDiffChange, onErrorChange, onPhaseChange, onSettle, onStageChange, onStartedAtChange, projectId, scopeCheck, source]);

  const handleCancel = useCallback(async () => {
    const runId = runIdRef.current;
    if (runId == null) {
      // No run was started by this dialog — nothing to cancel; just close.
      onSettle(false);
      return;
    }
    const adminInterface = getAdminInterface(adminApp);
    if (adminInterface == null) {
      onErrorChange("This dashboard build can't cancel a config run. Please refresh and try again.");
      return;
    }
    onPhaseChange("cancelling");
    try {
      await adminInterface.cancelConfigAgentRun(runId);
    } catch (error) {
      captureError("config-update-github-cancel", error);
    }
    // Settle directly: the cancel request hard-stops the run, but the handlePush
    // poll loop has already returned once the run reached "awaiting_review", so
    // there is no observer to leave the non-dismissible "cancelling" phase. Drive
    // the terminal transition here (mirroring the poll loop's `cancelled` branch)
    // for every entry point and regardless of whether the cancel call threw.
    onPhaseChange("check");
    onStageChange(null);
    onSettle(false);
  }, [adminApp, onErrorChange, onPhaseChange, onStageChange, onSettle]);

  const handleCommit = useCallback(async () => {
    const runId = runIdRef.current;
    if (runId == null) {
      onPhaseChange("check");
      onErrorChange("There is no run to commit. Start the update again.");
      return;
    }
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
      const result = await adminInterface.commitConfigAgentRun(runId, {
        githubAccessToken: tokenResult.data.accessToken,
        commitMessage: commitMessage.trim().length > 0 ? commitMessage : undefined,
      });
      if (result.status === "not-awaiting-review") {
        onPhaseChange("check");
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
          run = await adminInterface.getConfigAgentRun(runId);
        } catch {
          continue;
        }
        if (run == null || run.status === "awaiting_review") continue;
        if (run.status === "success") {
          onPhaseChange("check");
          onSettle(true);
          return;
        }
        if (run.status === "error") {
          onPhaseChange("check");
          onStageChange(null);
          onErrorChange(run.error ?? "Failed to commit and push the changes. Please try again.");
          return;
        }
        if (run.status === "cancelled") {
          onPhaseChange("check");
          onSettle(false);
          return;
        }
      }
      onPhaseChange("awaiting_review");
      onErrorChange("Timed out waiting for the commit. Check the repository for status.");
    } catch (error) {
      captureError("config-update-github-commit", error);
      onPhaseChange("check");
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

  // Auto-run: once the scope check passes, start the run without a manual click.
  // Guarded by a ref so a failed run (which lands back in "check" with an error)
  // does not retrigger — the user retries explicitly via the "Retry update" button.
  const autoStartedRef = useRef(false);
  useEffect(() => {
    if (
      phase === "check" &&
      scopeCheck.status === "ok" &&
      configUpdate != null &&
      errorMessage == null &&
      !autoStartedRef.current
    ) {
      autoStartedRef.current = true;
      runAsynchronously(handlePush);
    }
  }, [phase, scopeCheck.status, configUpdate, errorMessage, handlePush]);

  // Unlink hint, reused by both layouts.
  const unlinkHint = (
    <p className="text-xs text-muted-foreground">
      If your configuration is no longer sourced from GitHub, you can{" "}
      <Link href={projectSettingsHref(projectId)} className="underline">
        unlink it in your project settings
      </Link>.
    </p>
  );

  // Commit-form layout — one shape shared by running / cancelling /
  // awaiting_review / committing. Only the preview box swaps the loader out for
  // the diff; everything around it stays put.
  if (isCommitFormPhase(phase)) {
    const previewReady = phase === "awaiting_review" || phase === "committing";
    return (
      <div className="space-y-5">
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            This project&apos;s configuration was pushed from a file on GitHub. You can create a GitHub commit to apply your changes.
          </p>
          {unlinkHint}
        </div>

        <div className="space-y-1.5">
          <label htmlFor="push-commit-msg" className="text-sm font-medium">
            Commit message
          </label>
          <input
            id="push-commit-msg"
            type="text"
            className="w-full h-9 rounded-lg border border-border/50 bg-background px-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/40 transition-colors duration-150 hover:transition-none disabled:opacity-60"
            placeholder="chore(hexclave): update config from dashboard"
            value={commitMessage}
            onChange={(e) => onCommitMessageChange(e.target.value)}
            disabled={phase === "cancelling"}
          />
        </div>

        <div className="space-y-1.5">
          <div className="text-sm font-medium">Commit preview</div>
          <div className="rounded-xl border border-border/30 bg-background/60 overflow-hidden">
            {phase === "cancelling" ? (
              <p className="p-6 text-sm text-muted-foreground">Cancelling the update and stopping the agent…</p>
            ) : previewReady && diff != null && diff.trim().length > 0 ? (
              <AgentDiffViewer diff={diff} />
            ) : (
              <ConfigAgentPreviewProgress stage={stage} startedAt={startedAt} activity={activity} />
            )}
          </div>
        </div>

        {errorMessage != null && (
          <DesignAlert variant="error" description={errorMessage} />
        )}
      </div>
    );
  }

  // Scope-check layout (and the resting state after a failed run).
  return (
    <div className="space-y-4">
      {errorMessage != null && (
        <DesignAlert variant="error" description={errorMessage} />
      )}
      {unlinkHint}
    </div>
  );
}
