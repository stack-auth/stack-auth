import { Command } from "commander";
import { getInternalUser } from "../lib/app.js";
import { resolveLoginConfig, resolveSessionAuth } from "../lib/auth.js";
import { createProjectInteractively } from "../lib/create-project.js";
import { CliError } from "../lib/errors.js";

export type ProjectTarget = "cloud" | "local";

export type ProjectListEntry = {
  id: string,
  displayName: string,
  target: ProjectTarget,
};

export type ProjectListFlags = {
  cloud?: boolean,
  local?: boolean,
};

// Returns which sources `project list` should query. Exported for unit tests.
export function resolveProjectListSources(opts: ProjectListFlags = {}): {
  cloud: boolean,
  local: boolean,
} {
  if (opts.cloud && opts.local) {
    throw new CliError("Pass either --cloud or --local, not both. Omit both flags to list projects from both sources.");
  }

  if (opts.cloud) {
    return { cloud: true, local: false };
  }

  if (opts.local) {
    return { cloud: false, local: true };
  }

  return { cloud: true, local: true };
}

// Render projects for the human-readable list output. Each line is
// `<id>\t<displayName>\t[cloud|local]`. No projects → "No projects found." sentinel.
export function formatProjectList(projects: ProjectListEntry[]): string {
  if (projects.length === 0) {
    return "No projects found.";
  }
  return projects.map((p) => `${p.id}\t${p.displayName}\t[${p.target}]`).join("\n");
}

export function registerProjectCommand(program: Command) {
  const project = program
    .command("project")
    .description("Manage projects");

  project
    .command("list")
    .description("List your projects (defaults to both cloud and development-environment projects)")
    .option("--cloud", "Only list cloud projects")
    .option("--local", "Only list development-environment projects")
    .action(async (opts: ProjectListFlags) => {
      const sources = resolveProjectListSources(opts);
      const results: ProjectListEntry[] = [];
      const auth = resolveSessionAuth();
      const user = await getInternalUser(auth);
      const ownedProjects = await user.listOwnedProjects();
      for (const p of ownedProjects) {
        const target: ProjectTarget = p.isDevelopmentEnvironment ? "local" : "cloud";
        if ((target === "cloud" && sources.cloud) || (target === "local" && sources.local)) {
          results.push({ id: p.id, displayName: p.displayName, target });
        }
      }

      if (program.opts().json) {
        console.log(JSON.stringify(results, null, 2));
      } else {
        console.log(formatProjectList(results));
      }
    });

  project
    .command("create")
    .description("Create a new cloud project")
    .option("--cloud", "Confirm that this creates a cloud project")
    .option("--display-name <name>", "Project display name")
    .action(async (opts) => {
      if (!opts.cloud) {
        throw new CliError("hexclave project create currently only creates cloud projects. Pass --cloud to confirm.");
      }
      const [{ getInternalUser }, { resolveLoginConfig, resolveSessionAuth }, { createProjectInteractively }] = await Promise.all([
        import("../lib/app.js"),
        import("../lib/auth.js"),
        import("../lib/create-project.js"),
      ]);
      const auth = resolveSessionAuth();
      const user = await getInternalUser(auth);
      const { dashboardUrl } = resolveLoginConfig();

      const newProject = await createProjectInteractively(user, {
        displayName: opts.displayName,
        dashboardUrl,
      });

      if (program.opts().json) {
        console.log(JSON.stringify({ id: newProject.id, displayName: newProject.displayName, target: "cloud" }, null, 2));
      } else {
        console.log(`Project created: ${newProject.id} (${newProject.displayName})`);
      }
    });
}
