import { getInternalUser } from "../lib/app.js";
import { resolveLoginConfig, resolveSessionAuth } from "../lib/auth.js";
import { createProjectInteractively } from "../lib/create-project.js";
import { CliError } from "../lib/errors.js";
import { withProgress } from "../lib/progress.js";
import type { Command } from "commander";
import { formatProjectList, resolveProjectListSources, type ProjectListEntry, type ProjectListFlags } from "./project.js";

export async function runList(program: Command, opts: ProjectListFlags) {
  const sources = resolveProjectListSources(opts);
  const results: ProjectListEntry[] = [];
  const auth = resolveSessionAuth();
  const ownedProjects = await withProgress("Loading projects", async () => {
    const user = await getInternalUser(auth);
    return await user.listOwnedProjects();
  });
  for (const p of ownedProjects) {
    const target = p.isDevelopmentEnvironment ? "local" : "cloud";
    if ((target === "cloud" && sources.cloud) || (target === "local" && sources.local)) results.push({ id: p.id, displayName: p.displayName, target });
  }
  if (program.opts().json) console.log(JSON.stringify(results, null, 2));
  else console.log(formatProjectList(results));
}

export async function runCreate(program: Command, opts: { cloud?: boolean, displayName?: string }) {
  if (!opts.cloud) throw new CliError("hexclave project create currently only creates cloud projects. Pass --cloud to confirm.");
  const auth = resolveSessionAuth();
  const user = await withProgress("Loading account", async () => await getInternalUser(auth));
  const { dashboardUrl } = resolveLoginConfig();
  const newProject = await createProjectInteractively(user, { displayName: opts.displayName, dashboardUrl });
  if (program.opts().json) console.log(JSON.stringify({ id: newProject.id, displayName: newProject.displayName, target: "cloud" }, null, 2));
  else console.log(`Project created: ${newProject.id} (${newProject.displayName})`);
}
