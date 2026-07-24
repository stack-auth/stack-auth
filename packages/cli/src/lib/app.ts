import { StackClientApp } from "@hexclave/js";
import type { CurrentInternalUser, AdminOwnedProject } from "@hexclave/js";
import { AuthError } from "./errors.js";
import type { SessionAuth, ProjectAuthWithRefreshToken } from "./auth.js";

export function getInternalApp(auth: SessionAuth): StackClientApp<true, "internal"> {
  return new StackClientApp({
    projectId: "internal",
    publishableClientKey: auth.publishableClientKey,
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
  // Avoid `or: "throw"` here: its internal error message leaked to CLI users
  // and was reported as a fatal Sentry event instead of a normal auth error.
  const user = await app.getUser({ includeRestricted: true });
  if (user == null) {
    throw new AuthError("Your session is invalid or expired. Run `hexclave login` again.");
  }
  if (user.isRestricted) {
    const onboardingUrl = new URL("/onboarding", auth.dashboardUrl).toString();
    throw new AuthError(`Finish setting up your account at ${onboardingUrl} before using the CLI.`);
  }
  return user as CurrentInternalUser;
}

export async function getAdminProject(auth: ProjectAuthWithRefreshToken): Promise<AdminOwnedProject> {
  const user = await getInternalUser(auth);
  const projects = await user.listOwnedProjects();
  const project = projects.find((p) => p.id === auth.projectId);
  if (!project) {
    throw new AuthError(`Project '${auth.projectId}' not found. Make sure you own this project.`);
  }
  return project;
}
