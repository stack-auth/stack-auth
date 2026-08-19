"use client";

import { useDashboardInternalUser } from "@/lib/dashboard-user";
import { PrefetchUnavailableError, isPrefetching } from "@/lib/prefetch/hook-prefetcher";
import type { StackAdminApp, StackServerApp } from "@hexclave/next";
import { HexclaveAssertionError, throwErr } from "@hexclave/shared/dist/utils/errors";
import { notFound, usePathname } from "next/navigation";
import React from "react";

const HexclaveAdminAppContext = React.createContext<StackAdminApp<false> | null>(null);

export function AdminAppProvider(props: { children: React.ReactNode }) {
  const projectId = useProjectId();
  const app = useAdminApp(projectId);
  return (
    <HexclaveAdminAppContext.Provider value={app}>
      {props.children}
    </HexclaveAdminAppContext.Provider>
  );
}

export function useAdminAppIfExists() {
  const hexclaveAdminApp = React.useContext(HexclaveAdminAppContext);
  if (!hexclaveAdminApp) {
    return null;
  }

  return hexclaveAdminApp;
}

export function useServerAppIfExists(): StackServerApp<false> | null {
  return useAdminAppIfExists();
}

export function useAdminApp(projectId?: string) {
  const user = useDashboardInternalUser();
  const projects = user.useOwnedProjects();
  const providedApp = useAdminAppIfExists();

  if (projectId) {
    const project = projects.find(p => p.id === projectId);
    if (!project) {
      if (isPrefetching()) {
        // A prefetcher pointed us at a project this user doesn't own (eg. the Growth admin page links
        // into the customer projects it manages). `notFound()` here would 404 the page holding the
        // link, not the link target, because Next resolves not-found digests at the route level and
        // so escapes the prefetcher's own error boundary.
        throw new PrefetchUnavailableError(`Project ${projectId} is not owned by the current user, so it cannot be prefetched`);
      }
      console.warn(`Project ${projectId} does not exist, or ${user.id} does not have access to it`);
      return notFound();
    }
    return project.app;
  } else {
    return providedApp ?? throwErr("useAdminApp must be used within an AdminInterfaceProvider");
  }
}

export function useServerApp(projectId?: string): StackServerApp<false> {
  return useAdminApp(projectId);
}

export function useProjectId() {
  const pathname = usePathname();
  if (!pathname.startsWith("/projects/")) {
    throw new HexclaveAssertionError("useProjectId must be used within a project route");
  }
  const projectId = pathname.split("/")[2];
  return projectId;
}
