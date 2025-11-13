"use client";

import { StackAdminApp, useUser } from "@stackframe/stack";
import { StackAssertionError, throwErr } from "@stackframe/stack-shared/dist/utils/errors";
import { notFound, usePathname } from "next/navigation";
import React from "react";

const StackAdminAppContext = React.createContext<StackAdminApp<false> | null>(null);

export function AdminAppProvider(props: { children: React.ReactNode }) {
  const projectId = useProjectId();
  const app = useAdminApp(projectId);
  return (
    <StackAdminAppContext.Provider value={app}>
      {props.children}
    </StackAdminAppContext.Provider>
  );
}

export function useAdminAppIfExists() {
  const stackAdminApp = React.useContext(StackAdminAppContext);
  if (!stackAdminApp) {
    return null;
  }

  return stackAdminApp;
}

export function useAdminApp(projectId?: string) {
  const user = useUser({ or: "redirect", projectIdMustMatch: "internal" });
  const projects = user.useOwnedProjects();
  const providedApp = useAdminAppIfExists();

  if (projectId) {
    const project = projects.find(p => p.id === projectId);
    if (!project) {
      console.warn(`Project ${projectId} does not exist, or ${user.id} does not have access to it`);
      return notFound();
    }
    return project.app;
  } else {
    return providedApp ?? throwErr("useAdminApp must be used within an AdminInterfaceProvider");
  }
}

export function useProjectId() {
  const pathname = usePathname();
  if (!pathname.startsWith("/projects/")) {
    throw new StackAssertionError("useProjectId must be used within a project route");
  }
  const projectId = pathname.split("/")[2];
  return projectId;
}
