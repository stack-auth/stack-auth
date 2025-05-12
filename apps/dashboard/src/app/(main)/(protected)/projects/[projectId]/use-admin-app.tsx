"use client";

import { StackAdminApp, useUser } from "@stackframe/stack";
import { StackAssertionError } from "@stackframe/stack-shared/dist/utils/errors";
import { notFound } from "next/navigation";
import React from "react";

const StackAdminAppContext = React.createContext<StackAdminApp<false> | null>(null);

export function AdminAppProvider(props: { projectId: string, children: React.ReactNode }) {
  const user = useUser({ or: "redirect", projectIdMustMatch: "internal" });
  const projects = user.useOwnedProjects();

  const project = projects.find(p => p.id === props.projectId);
  if (!project) {
    console.warn(`Project ${props.projectId} does not exist, or ${user.id} does not have access to it`);
    return notFound();
  }

  return (
    <StackAdminAppContext.Provider value={project.app}>
      {props.children}
    </StackAdminAppContext.Provider>
  );
}

export function useAdminApp() {
  const stackAdminApp = React.useContext(StackAdminAppContext);
  if (!stackAdminApp) {
    throw new StackAssertionError("useAdminApp must be used within an AdminInterfaceProvider");
  }

  return stackAdminApp;
}
