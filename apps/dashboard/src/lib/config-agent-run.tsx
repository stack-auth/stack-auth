'use client';

import { useAdminAppIfExists } from "@/app/(main)/(protected)/projects/[projectId]/use-admin-app";
import { ActionDialog } from "@/components/ui/action-dialog";
import { captureError } from "@hexclave/shared/dist/utils/errors";
import React, { useCallback, useEffect, useRef, useState } from "react";

import { ConfigAgentActivityFeed, useGithubRunActive } from "./config-update";

/**
 * Watches the linked-GitHub config source for an in-flight agent run and, when
 * one is running, pops a NON-DISMISSIBLE progress modal — so opening the project
 * (in any tab, or after a reload) while a run is going surfaces it and prevents
 * starting a conflicting edit. The only way out is Cancel (hard-stops the
 * sandbox) or the run reaching a terminal status.
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

async function readPushedConfigSource(adminApp: unknown): Promise<any | null> {
  const iface = (adminApp as any)?._interface;
  if (iface == null || typeof iface.getPushedConfigSource !== "function") return null;
  try {
    return await iface.getPushedConfigSource();
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

  // Keep the latest phase readable inside the polling loop without retriggering it.
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  const handleCancel = useCallback(async (): Promise<"prevent-close" | undefined> => {
    const iface = (adminApp as any)?._interface;
    if (iface == null || typeof iface.cancelConfigAgentRun !== "function") {
      setErrorMessage("This dashboard build can't cancel a config run. Please refresh and try again.");
      setPhase("error");
      return "prevent-close";
    }
    setErrorMessage(null);
    setPhase("cancelling");
    try {
      await iface.cancelConfigAgentRun();
    } catch (error) {
      // Best-effort: the poll loop still settles if the cancel landed.
      captureError("config-agent-watcher-cancel", error);
    }
    return "prevent-close";
  }, [adminApp]);

  useEffect(() => {
    if (!adminApp) return;
    // Mutable holder (not a `let`) so eslint's flow analysis doesn't treat the
    // post-await `stopped` check as always-false — the flag is flipped in cleanup.
    const loop = { stopped: false };
    let timer: ReturnType<typeof setTimeout> | undefined;

    const apply = (source: any): number => {
      if (!source || source.type !== "pushed-from-github") {
        if (phaseRef.current !== "error") setPhase("hidden");
        return UNLINKED_POLL_MS;
      }
      setSourceInfo({ owner: source.owner, repo: source.repo, branch: source.branch });
      const status: string | undefined = source.agent_run?.status;

      // This tab's push dialog owns the modal for runs it started.
      if (githubRunActive) {
        if (phaseRef.current !== "hidden") setPhase("hidden");
        return LINKED_IDLE_POLL_MS;
      }
      if (status === "running") {
        setActivity(typeof source.agent_run?.progress === "string" ? source.agent_run.progress : null);
        if (phaseRef.current !== "cancelling") setPhase("running");
        return ACTIVE_POLL_MS;
      }
      // Terminal (or no run). Only surface an error if we were actively showing
      // this run — a stale error from before the page loaded shouldn't pop a modal.
      if (status === "error" && (phaseRef.current === "running" || phaseRef.current === "cancelling")) {
        setErrorMessage(source.agent_run?.error ?? "The config agent failed to apply the change.");
        setPhase("error");
        return LINKED_IDLE_POLL_MS;
      }
      if (phaseRef.current !== "error") setPhase("hidden");
      return LINKED_IDLE_POLL_MS;
    };

    const tick = async () => {
      const source = await readPushedConfigSource(adminApp);
      if (loop.stopped) return; // unmounted while the request was in flight
      const delay = apply(source);
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
      title="Configuration update in progress"
      description={`A configuration change is being applied to ${linked} via the config agent.`}
      cancelButton={{
        label: phase === "cancelling" ? "Cancelling…" : "Cancel update",
        onClick: handleCancel,
        props: { disabled: phase === "cancelling" },
      }}
    >
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          {phase === "cancelling"
            ? "Cancelling the update and stopping the agent…"
            : "Applying your change in a sandbox and committing it to GitHub. This can take a couple of minutes."}
        </p>
        {phase !== "cancelling" && activity != null && activity.trim().length > 0 && (
          <ConfigAgentActivityFeed activity={activity} />
        )}
        {errorMessage != null && (
          <p className="text-sm text-destructive">{errorMessage}</p>
        )}
      </div>
    </ActionDialog>
  );
}
