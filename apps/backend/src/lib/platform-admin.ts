import { UsersCrud } from "@hexclave/shared/dist/interface/crud/users";
import { StatusError } from "@hexclave/shared/dist/utils/errors";
import { listManagedProjectIds } from "./projects";

// Authorization for platform-wide (cross-customer) internal endpoints.
//
// Being a signed-in user of the "internal" project is NOT sufficient: the
// internal project's publishable client key is public and, on deployments with
// open dashboard sign-up, anyone can create an internal-project account (in their
// own team). Access is therefore gated on membership of the team that OWNS the
// internal project — i.e. the platform team. That is exactly what
// `listManagedProjectIds` encodes (a user manages a project when they belong to
// its owner team), so the internal project appears in that list only for platform
// team members.

export async function isPlatformAdmin(user: UsersCrud["Admin"]["Read"]): Promise<boolean> {
  const managedProjectIds = await listManagedProjectIds(user);
  return managedProjectIds.includes("internal");
}

export async function ensurePlatformAdmin(user: UsersCrud["Admin"]["Read"]): Promise<void> {
  if (!(await isPlatformAdmin(user))) {
    throw new StatusError(403, "You do not have access to platform analytics.");
  }
}
