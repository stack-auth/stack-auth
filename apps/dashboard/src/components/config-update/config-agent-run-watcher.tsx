'use client';

import { useAdminAppIfExists } from "@/app/(main)/(protected)/projects/[projectId]/use-admin-app";
import { ActionDialog } from "@/components/ui/action-dialog";
import { GitBranch } from "@phosphor-icons/react";
import type { StackAdminApp } from "@hexclave/next";
import { captureError } from "@hexclave/shared/dist/utils/errors";
import React, { useCallback, useEffect, useRef, useState } from "react";

import { ConfigAgentRunProgressContent } from "./progress-content";
import { type AgentStage, type ConfigAgentRun, getAdminInterface, useGithubRunActive } from "./shared";

/**
 * Watches the linked-GitHub config source for an in-flight agent run and, when
 * one is running, pops a NON-DISMISSIBLE progress modal so opening the project
 * in another tab surfaces it and prevents starting a conflicting edit. Review
 * and commit stay owned by the push dialog that started the run.
 *
 * Mounted once per project (inside `AdminAppProvider`). It deliberately stays
 * silent for runs THIS tab started via the push dialog — that dialog owns the
 * modal and flags the run via `useGithubRunActive()`.
 */
type WatcherPhase = "hidden" | "running" | "cancelling" | "error";
type SourceInfo = { owner: string, repo: string, branch: string };

const ACTIVE_POLL_MS = 3_000;       // a run is on screen — poll tightly
const LINKED_IDLE_POLL_MS = 10_000; // linked repo, no run — watch for new runs
const UNLINKED_POLL_MS = 30_000;    // not a GitHub-linked project — back off

type RunSnapshot = { owner: string, repo: string, branch: string, run: ConfigAgentRun | null };

async function readRunSnapshot(adminApp: StackAdminApp<false> | null): Promise<RunSnapshot | null> {
  const iface = getAdminInterface(adminApp);
  if (iface == null) return null;
  try {
    const source = await iface.getPushedConfigSource();
    if (source.type !== "pushed-from-github") return null;
    const run = await iface.getConfigAgentRun();
    return { owner: source.owner, repo: source.repo, branch: source.branch, run };
  } catch {
    return null; // transient — try again next tick
  }
}

export function ConfigAgentRunWatcher() {
  const adminApp = useAdminAppIfExists();
  const githubRunActive = useGithubRunActive();

  const [phase, setPhase] = useState<WatcherPhase>("hidden");
  const [sourceInfo, setSourceInfo] = useState<SourceInfo | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [activity, setActivity] = useState<string | null>(null);
  const [stage, setStage] = useState<AgentStage | null>(null);
  const [startedAt, setStartedAt] = useState<number>(0);

  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  const handleCancel = useCallback(async (): Promise<"prevent-close" | undefined> => {
    const iface = getAdminInterface(adminApp);
    if (iface == null) {
      setErrorMessage("This dashboard build can't cancel a config run. Please refresh and try again.");
      setPhase("error");
      return "prevent-close";
    }
    setErrorMessage(null);
    setPhase("cancelling");
    try {
      await iface.cancelConfigAgentRun();
    } catch (error) {
      captureError("config-agent-watcher-cancel", error);
    }
    return "prevent-close";
  }, [adminApp]);

  useEffect(() => {
    if (!adminApp) return;
    const loop = { stopped: false };
    let timer: ReturnType<typeof setTimeout> | undefined;

    const apply = (snap: RunSnapshot | null): number => {
      if (snap == null) {
        if (phaseRef.current !== "error") setPhase("hidden");
        return UNLINKED_POLL_MS;
      }
      setSourceInfo({ owner: snap.owner, repo: snap.repo, branch: snap.branch });
      const run = snap.run;

      // This tab's push dialog owns the modal for runs it started.
      if (githubRunActive) {
        if (phaseRef.current !== "hidden") setPhase("hidden");
        return LINKED_IDLE_POLL_MS;
      }
      if (run?.status === "running") {
        setActivity(run.progress ?? null);
        if (run.stage != null) setStage(run.stage);
        setStartedAt(run.started_at);
        if (phaseRef.current !== "cancelling") setPhase("running");
        return ACTIVE_POLL_MS;
      }
      if (run?.status === "error" && (phaseRef.current === "running" || phaseRef.current === "cancelling")) {
        setErrorMessage(run.error ?? "The config agent failed to apply the change.");
        setPhase("error");
        return LINKED_IDLE_POLL_MS;
      }
      if (phaseRef.current !== "error") setPhase("hidden");
      return LINKED_IDLE_POLL_MS;
    };

    const tick = async () => {
      const snap = await readRunSnapshot(adminApp);
      if (loop.stopped) return;
      const delay = apply(snap);
      timer = setTimeout(() => void tick(), delay);
    };

    timer = setTimeout(() => void tick(), 0);
    return () => {
      loop.stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [adminApp, githubRunActive]);

  if (phase === "hidden") return null;

  const linked = sourceInfo ? `${sourceInfo.owner}/${sourceInfo.repo}@${sourceInfo.branch}` : "GitHub";

  if (phase === "error") {
    return (
      <ActionDialog
        open
        onClose={() => setPhase("hidden")}
        title="Configuration update failed"
        okButton={{ label: "Close", onClick: async () => { setPhase("hidden"); } }}
      >
        <p className="text-sm text-destructive">
          {errorMessage ?? "The config agent failed to apply the change."}
        </p>
      </ActionDialog>
    );
  }

  return (
    <ActionDialog
      open
      preventClose
      titleIcon={GitBranch}
      title="Push configuration to GitHub"
      description={`Applying your change in a sandbox — ${linked}`}
      cancelButton={{
        label: phase === "cancelling" ? "Cancelling…" : "Cancel",
        onClick: handleCancel,
        props: { disabled: phase === "cancelling", variant: "outline" },
      }}
    >
      <ConfigAgentRunProgressContent
        isCancelling={phase === "cancelling"}
        stage={stage}
        startedAt={startedAt}
        activity={activity}
        errorMessage={errorMessage}
      />
    </ActionDialog>
  );
}
