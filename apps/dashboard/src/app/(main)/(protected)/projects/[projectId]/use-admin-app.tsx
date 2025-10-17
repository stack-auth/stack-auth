"use client";

import { StackAdminApp, useUser } from "@stackframe/stack";
import { throwErr } from "@stackframe/stack-shared/dist/utils/errors";
import { notFound } from "next/navigation";
import React from "react";

const StackAdminAppContext = React.createContext<StackAdminApp<false> | null>(null);

export function AdminAppProvider(props: { projectId: string, children: React.ReactNode }) {
  const app = useAdminApp(props.projectId);
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
