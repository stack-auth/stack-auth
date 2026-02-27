import { StackClientApp } from "@stackframe/js";
import type { CurrentInternalUser, AdminOwnedProject } from "@stackframe/js";
import { AuthError } from "./errors.js";
import { DEFAULT_PUBLISHABLE_CLIENT_KEY } from "./auth.js";
import type { SessionAuth, ProjectAuth } from "./auth.js";

export function getInternalApp(auth: SessionAuth): StackClientApp<true, "internal"> {
  return new StackClientApp({
    projectId: "internal",
    publishableClientKey: DEFAULT_PUBLISHABLE_CLIENT_KEY,
    baseUrl: auth.apiUrl,
    tokenStore: {
      accessToken: "",
      refreshToken: auth.refreshToken,
    },
    noAutomaticPrefetch: true,
  });
}

export async function getInternalUser(auth: SessionAuth): Promise<CurrentInternalUser> {
  const app = getInternalApp(auth);
  const user = await app.getUser({ or: "throw" });
  return user as CurrentInternalUser;
}

export async function getAdminProject(auth: ProjectAuth): Promise<AdminOwnedProject> {
  const user = await getInternalUser(auth);
  const projects = await user.listOwnedProjects();
  const project = projects.find((p) => p.id === auth.projectId);
  if (!project) {
    throw new AuthError(`Project '${auth.projectId}' not found. Make sure you own this project.`);
  }
  return project;
}
