"use client";

import Loading from "@/app/loading";
import { useRouter } from "@/components/router";
import { getPublicEnvVar } from "@/lib/env";
import { stackAppInternalsSymbol } from "@/lib/stack-app-internals";
import { useStackApp, useUser, type CurrentInternalUser } from "@stackframe/stack";
import { runAsynchronouslyWithAlert } from "@stackframe/stack-shared/dist/utils/promises";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { getPreviewTargetPath } from "./preview-lease-path";

type PreviewLeaseResponse = {
  projectId: string,
  userId: string,
  accessToken: string,
  refreshToken: string,
};

type StackAppPreviewLeaseInternals = {
  sendRequest: (path: string, requestOptions: RequestInit, requestType?: "client" | "server" | "admin") => Promise<Response>,
  signInWithTokens: (tokens: { accessToken: string, refreshToken: string }) => Promise<void>,
  refreshOwnedProjects: () => Promise<void>,
};

function isStackAppPreviewLeaseInternals(value: unknown): value is StackAppPreviewLeaseInternals {
  return (
    value != null &&
    typeof value === "object" &&
    "sendRequest" in value &&
    typeof value.sendRequest === "function" &&
    "signInWithTokens" in value &&
    typeof value.signInWithTokens === "function" &&
    "refreshOwnedProjects" in value &&
    typeof value.refreshOwnedProjects === "function"
  );
}

function getStackAppPreviewLeaseInternals(appValue: unknown): StackAppPreviewLeaseInternals {
  if (appValue == null || typeof appValue !== "object") {
    throw new Error("The Stack app instance is unavailable.");
  }

  const internals = Reflect.get(appValue, stackAppInternalsSymbol);
  if (!isStackAppPreviewLeaseInternals(internals)) {
    throw new Error("The Stack client app cannot install preview lease tokens.");
  }

  return internals;
}

function parsePreviewLeaseResponse(value: unknown): PreviewLeaseResponse {
  if (
    value == null ||
    typeof value !== "object" ||
    !("project_id" in value) ||
    typeof value.project_id !== "string" ||
    !("user_id" in value) ||
    typeof value.user_id !== "string" ||
    !("access_token" in value) ||
    typeof value.access_token !== "string" ||
    !("refresh_token" in value) ||
    typeof value.refresh_token !== "string"
  ) {
    throw new Error("Preview lease endpoint returned an invalid response.");
  }

  return {
    projectId: value.project_id,
    userId: value.user_id,
    accessToken: value.access_token,
    refreshToken: value.refresh_token,
  };
}

function getCurrentLocationSuffix(): string {
  if (typeof window === "undefined") {
    return "";
  }
  return `${window.location.search}${window.location.hash}`;
}

async function claimPreviewLease(app: unknown): Promise<PreviewLeaseResponse> {
  const internals = getStackAppPreviewLeaseInternals(app);
  const response = await internals.sendRequest(
    "/internal/preview/claim",
    { method: "POST" },
    "client",
  );

  if (!response.ok) {
    throw new Error(`Failed to claim preview lease: ${response.status}${response.statusText ? ` ${response.statusText}` : ""}`);
  }

  return parsePreviewLeaseResponse(await response.json());
}

function PreviewLeaseClaimGate() {
  const app = useStackApp();
  const claimStarted = useRef(false);

  useEffect(() => {
    if (claimStarted.current) return;
    claimStarted.current = true;

    runAsynchronouslyWithAlert(async () => {
      const lease = await claimPreviewLease(app);
      const internals = getStackAppPreviewLeaseInternals(app);
      await internals.signInWithTokens({
        accessToken: lease.accessToken,
        refreshToken: lease.refreshToken,
      });
      await internals.refreshOwnedProjects();
    });
  }, [app]);

  return <Loading />;
}

function PreviewLeaseProjectRedirectGate(props: { children: React.ReactNode, user: CurrentInternalUser }) {
  const router = useRouter();
  const pathname = usePathname();
  const projects = props.user.useOwnedProjects();

  useEffect(() => {
    if (projects.length === 0) return;
    const projectId = projects[0].id;
    const targetPath = getPreviewTargetPath(pathname, projectId);
    if (targetPath !== pathname) {
      router.replace(`${targetPath}${getCurrentLocationSuffix()}`);
    }
  }, [pathname, projects, router]);

  if (projects.length === 0) {
    return <PreviewLeaseClaimGate />;
  }

  const projectId = projects[0].id;
  if (getPreviewTargetPath(pathname, projectId) !== pathname) {
    return <Loading />;
  }

  return props.children;
}

function PreviewLeaseAuthGateInner(props: { children: React.ReactNode }) {
  const user = useUser({ or: "return-null", projectIdMustMatch: "internal" });
  if (user == null) {
    return <PreviewLeaseClaimGate />;
  }

  return (
    <PreviewLeaseProjectRedirectGate user={user}>
      {props.children}
    </PreviewLeaseProjectRedirectGate>
  );
}

export function PreviewLeaseAuthGate(props: { children: React.ReactNode }) {
  const isPreview = getPublicEnvVar("NEXT_PUBLIC_STACK_IS_PREVIEW") === "true";
  if (!isPreview) {
    return props.children;
  }

  return (
    <PreviewLeaseAuthGateInner>
      {props.children}
    </PreviewLeaseAuthGateInner>
  );
}
