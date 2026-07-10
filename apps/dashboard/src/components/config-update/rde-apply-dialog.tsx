'use client';

import { DesignAlert, DesignButton, DesignDialog, DesignDialogClose } from "@/components/design-components";
import type { StackAdminApp } from "@hexclave/next";
import type { EnvironmentConfigOverrideOverride } from "@hexclave/shared/dist/config/schema";
import { captureError } from "@hexclave/shared/dist/utils/errors";
import { runAsynchronously } from "@hexclave/shared/dist/utils/promises";
import { ArrowsClockwise, Terminal } from "@phosphor-icons/react";
import React, { useCallback, useEffect, useRef, useState } from "react";

import { ConfigApplyProgressBox } from "./progress-content";
import { currentEpochMsFromPerformance } from "./shared";

type RdeApplyDialogProps = {
  open: boolean,
  adminApp: StackAdminApp<false> | null,
  configUpdate: EnvironmentConfigOverrideOverride | null,
  onSettle: (result: boolean) => void,
};

// CLI / remote-development-environment apply. Unlike the GitHub flow there's no
// review step — the change is written straight to the local config file the CLI
// manages and we wait for it to sync. We reuse the same running/cancelling
// presentation so dashboard config applies feel identical across backends.
// "running": apply in flight (non-dismissible; Cancel aborts the request).
// "cancelling": user clicked Cancel, request is aborting.
// "error": apply failed; resting state with a retry.
type RdePhase = "running" | "cancelling" | "error";

/**
 * Drives a CLI/RDE local config apply with the shared progress UI. Auto-starts
 * on open and settles `true` on success, `false` on cancel/redirect.
 */
export function RdeApplyDialog({ open, adminApp, configUpdate, onSettle }: RdeApplyDialogProps) {
  const [phase, setPhase] = useState<RdePhase>("running");
  const [startedAt, setStartedAt] = useState<number>(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const autoStartedRef = useRef(false);

  const isNonDismissible = phase === "running" || phase === "cancelling";

  const startApply = useCallback(() => {
    if (adminApp == null || configUpdate == null) {
      setErrorMessage("No configuration changes to apply.");
      setPhase("error");
      return;
    }
    // Lazily import so this client chunk doesn't pull the RDE client into the
    // common config-update bundle.
    const controller = new AbortController();
    abortRef.current = controller;
    setErrorMessage(null);
    setStartedAt(currentEpochMsFromPerformance());
    setPhase("running");

    runAsynchronously(async () => {
      try {
        const { updateRemoteDevelopmentEnvironmentConfigFile } = await import("./remote-development-environment");
        const result = await updateRemoteDevelopmentEnvironmentConfigFile(adminApp, configUpdate, { signal: controller.signal });
        if (controller.signal.aborted) {
          onSettle(false);
          return;
        }
        // "redirecting": the browser secret flow took over; treat as not-applied.
        onSettle(result === "updated");
      } catch (error) {
        if (controller.signal.aborted) {
          onSettle(false);
          return;
        }
        captureError("config-update-rde-apply", error);
        setErrorMessage(error instanceof Error ? error.message : "Failed to apply the change to your local development environment.");
        setPhase("error");
      }
    });
  }, [adminApp, configUpdate, onSettle]);

  // Auto-start once on open; a failed apply lands in "error" and is retried
  // explicitly via the Retry button (which calls startApply again).
  useEffect(() => {
    if (!open || autoStartedRef.current) return;
    autoStartedRef.current = true;
    startApply();
  }, [open, startApply]);

  const handleCancel = useCallback(() => {
    setPhase("cancelling");
    abortRef.current?.abort();
    // The in-flight apply observes the aborted signal and settles `false`.
  }, []);

  const description = (() => {
    switch (phase) {
      case "running":
      case "cancelling": {
        return "Applying your change to the local configuration file managed by the Hexclave CLI.";
      }
      case "error": {
        return "The change could not be applied to your local development environment.";
      }
    }
  })();

  const footer = (() => {
    if (phase === "error") {
      return (
        <div className="flex items-center gap-2">
          <DesignDialogClose asChild>
            <DesignButton variant="outline" size="sm" onClick={async () => { onSettle(false); }}>
              Close
            </DesignButton>
          </DesignDialogClose>
          <DesignButton size="sm" onClick={async () => { startApply(); }}>
            <ArrowsClockwise className="h-3.5 w-3.5 mr-1.5" />
            Retry
          </DesignButton>
        </div>
      );
    }
    // running / cancelling
    return (
      <DesignButton
        variant="outline"
        size="sm"
        disabled={phase === "cancelling"}
        onClick={async () => { handleCancel(); }}
      >
        {phase === "cancelling" ? "Cancelling…" : "Cancel"}
      </DesignButton>
    );
  })();

  return (
    <DesignDialog
      open={open}
      onOpenChange={(o) => {
        if (o || isNonDismissible) return;
        onSettle(false);
      }}
      size="lg"
      icon={Terminal}
      title="Apply configuration"
      description={description}
      hideTopCloseButton={isNonDismissible}
      footer={footer}
      contentProps={{ onPointerDownOutside: isNonDismissible ? (e) => e.preventDefault() : undefined, onEscapeKeyDown: isNonDismissible ? (e) => e.preventDefault() : undefined }}
    >
      <div className="space-y-4">
        <div className="rounded-xl border border-border/30 bg-background/60 overflow-hidden">
          {phase === "cancelling" ? (
            <p className="p-6 text-sm text-muted-foreground">Cancelling the update…</p>
          ) : phase === "error" ? (
            <p className="p-6 text-sm text-muted-foreground">No changes were applied. You can retry the update.</p>
          ) : (
            <ConfigApplyProgressBox
              title="Applying changes…"
              detail="Waiting for the CLI to sync"
              startedAt={startedAt}
            />
          )}
        </div>

        {errorMessage != null && (
          <DesignAlert variant="error" description={errorMessage} />
        )}
      </div>
    </DesignDialog>
  );
}
