"use client";

import { DevErrorNotifier } from "@/components/dev-error-notifier";
import { RouterProvider } from "@/components/router";
import { SiteLoadingIndicatorDisplay } from "@/components/site-loading-indicator";
import { Toaster } from "@/components/ui";
import { VersionAlerter } from "@/components/version-alerter";
import { getPublicEnvVar } from "@/lib/env";
import { stackClientApp } from "@/stack/client";
import { StackProvider, StackTheme } from "@stackframe/stack";
import { runAsynchronouslyWithAlert } from "@stackframe/stack-shared/dist/utils/promises";
import React, { useSyncExternalStore } from "react";
import { BackgroundShine } from "./background-shine";
import { ClientPolyfill } from "./client-polyfill";
import { DevelopmentPortDisplay } from "./development-port-display";
import Loading from "./loading";
import { UserIdentity } from "./providers";
import { RemoteDevelopmentEnvironmentAuthGate } from "./remote-development-environment-auth-gate";

const DEV_ENVIRONMENT_HEALTHCHECK_INTERVAL_MS = 2_000;

type DevEnvironmentHealthSnapshot =
  | { status: "checking" | "healthy" }
  | { status: "unhealthy", restartCommand: string };

function isDevEnvironmentHealthResponse(value: unknown): value is { ok: boolean, restart_command: string } {
  return (
    value != null &&
    typeof value === "object" &&
    "ok" in value &&
    typeof value.ok === "boolean" &&
    "restart_command" in value &&
    typeof value.restart_command === "string"
  );
}

let devEnvironmentHealthSnapshot: DevEnvironmentHealthSnapshot = { status: "checking" };
const devEnvironmentHealthSubscribers = new Set<() => void>();
let devEnvironmentHealthTimer: ReturnType<typeof setInterval> | undefined;
let devEnvironmentHealthRequestSequence = 0;

function setDevEnvironmentHealthSnapshot(snapshot: DevEnvironmentHealthSnapshot) {
  devEnvironmentHealthSnapshot = snapshot;
  for (const subscriber of devEnvironmentHealthSubscribers) {
    subscriber();
  }
}

async function refreshDevEnvironmentHealth() {
  const requestSequence = ++devEnvironmentHealthRequestSequence;
  const setSnapshotIfCurrent = (snapshot: DevEnvironmentHealthSnapshot) => {
    if (requestSequence === devEnvironmentHealthRequestSequence) {
      setDevEnvironmentHealthSnapshot(snapshot);
    }
  };

  try {
    const response = await fetch("/api/development-environment/health", {
      cache: "no-store",
      headers: {
        Accept: "application/json",
      },
    });
    const body: unknown = await response.json();
    if (!isDevEnvironmentHealthResponse(body)) {
      throw new Error("Development environment health endpoint returned an invalid response.");
    }

    setSnapshotIfCurrent(body.ok && response.ok
      ? { status: "healthy" }
      : { status: "unhealthy", restartCommand: body.restart_command });
  } catch {
    setSnapshotIfCurrent({
      status: "unhealthy",
      restartCommand: "stack dev --config-file <path-to-stack.config.ts> -- <your app command>",
    });
  }
}

function subscribeDevEnvironmentHealth(callback: () => void) {
  devEnvironmentHealthSubscribers.add(callback);
  if (devEnvironmentHealthSubscribers.size === 1) {
    setDevEnvironmentHealthSnapshot({ status: "checking" });
    runAsynchronouslyWithAlert(refreshDevEnvironmentHealth());
    devEnvironmentHealthTimer = setInterval(() => {
      runAsynchronouslyWithAlert(refreshDevEnvironmentHealth());
    }, DEV_ENVIRONMENT_HEALTHCHECK_INTERVAL_MS);
  }

  return () => {
    devEnvironmentHealthSubscribers.delete(callback);
    if (devEnvironmentHealthSubscribers.size === 0 && devEnvironmentHealthTimer !== undefined) {
      clearInterval(devEnvironmentHealthTimer);
      devEnvironmentHealthTimer = undefined;
    }
  };
}

function getDevEnvironmentHealthSnapshot() {
  return devEnvironmentHealthSnapshot;
}

function getServerDevEnvironmentHealthSnapshot(): DevEnvironmentHealthSnapshot {
  return { status: "checking" };
}

function subscribeHealthyDevEnvironment(_callback: () => void) {
  return () => {};
}

function getHealthyDevEnvironmentSnapshot(): DevEnvironmentHealthSnapshot {
  return { status: "healthy" };
}

function DevEnvironmentStoppedScreen(props: { restartCommand: string }) {
  return (
    <div className="relative z-10 min-h-screen bg-background text-foreground flex items-center justify-center px-4">
      <div className="w-full max-w-lg rounded-2xl border border-black/[0.10] dark:border-white/[0.10] bg-white dark:bg-background p-6 shadow-sm">
        <div className="mb-3 inline-flex rounded-full bg-blue-500/10 px-3 py-1 text-xs font-medium text-blue-700 dark:text-blue-300">
          Development environment paused
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">The dev environment is not currently running</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          Your Stack Auth changes have been saved. The local Stack Auth development environment just is not active right now, so the dashboard has paused instead of showing stale project data.
        </p>
        <p className="mt-4 text-sm leading-6 text-muted-foreground">
          Restart it from your terminal with:
        </p>
        <pre className="mt-3 overflow-x-auto rounded-lg bg-black/[0.04] dark:bg-white/[0.06] px-3 py-2 text-sm"><code>{props.restartCommand}</code></pre>
      </div>
    </div>
  );
}

function DevEnvironmentHealthGate(props: { children: React.ReactNode }) {
  const isLocalEmulator = getPublicEnvVar("NEXT_PUBLIC_STACK_IS_LOCAL_EMULATOR") === "true";
  const isRemoteDevelopmentEnvironment = getPublicEnvVar("NEXT_PUBLIC_STACK_IS_REMOTE_DEVELOPMENT_ENVIRONMENT") === "true";
  const shouldCheckHealth = isLocalEmulator || isRemoteDevelopmentEnvironment;
  const health = useSyncExternalStore(
    shouldCheckHealth ? subscribeDevEnvironmentHealth : subscribeHealthyDevEnvironment,
    shouldCheckHealth ? getDevEnvironmentHealthSnapshot : getHealthyDevEnvironmentSnapshot,
    shouldCheckHealth ? getServerDevEnvironmentHealthSnapshot : getHealthyDevEnvironmentSnapshot,
  );

  if (!shouldCheckHealth) {
    return props.children;
  }

  if (health.status === "unhealthy") {
    return <DevEnvironmentStoppedScreen restartCommand={health.restartCommand} />;
  }

  if (health.status === "checking") {
    return <Loading />;
  }

  return props.children;
}

export function LayoutClient(props: {
  children: React.ReactNode,
  translationLocale?: string,
}) {
  return (
    <>
      <StackProvider app={stackClientApp} lang={props.translationLocale as React.ComponentProps<typeof StackProvider>["lang"]}>
        <StackTheme>
          <ClientPolyfill />
          <DevEnvironmentHealthGate>
            <RemoteDevelopmentEnvironmentAuthGate>
              <RouterProvider>
                <UserIdentity />
                <VersionAlerter />
                <BackgroundShine />
                {props.children}
                <DevelopmentPortDisplay />
              </RouterProvider>
            </RemoteDevelopmentEnvironmentAuthGate>
          </DevEnvironmentHealthGate>
        </StackTheme>
      </StackProvider>
      <DevErrorNotifier />
      <Toaster />
      <SiteLoadingIndicatorDisplay />
    </>
  );
}
