import { Command } from "commander";
import { getInternalUser } from "../lib/app.js";
import { resolveLoginConfig, resolveSessionAuth } from "../lib/auth.js";
import { createProjectInteractively } from "../lib/create-project.js";
import { CliError } from "../lib/errors.js";

export type ProjectTarget = "cloud" | "dev";

export type ProjectListEntry = {
  id: string,
  displayName: string,
  target: ProjectTarget,
};

export type ProjectListFlags = {
  cloud?: boolean,
  dev?: boolean,
};

// Returns which sources `project list` should query. Exported for unit tests.
export function resolveProjectListSources(opts: ProjectListFlags = {}): {
  cloud: boolean,
  dev: boolean,
} {
  if (opts.cloud && opts.dev) {
    throw new CliError("Pass either --cloud or --dev, not both. Omit both flags to list projects from both sources.");
  }

  if (opts.cloud) {
    return { cloud: true, dev: false };
  }

  if (opts.dev) {
    return { cloud: false, dev: true };
  }

  return { cloud: true, dev: true };
}

// Render projects for the human-readable list output. Each line is
// `<id>\t<displayName>\t[cloud|dev]`. No projects → "No projects found." sentinel.
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
    .option("--dev", "Only list development-environment projects")
    .action(async (opts: ProjectListFlags) => {
      const sources = resolveProjectListSources(opts);
      const results: ProjectListEntry[] = [];
      const auth = resolveSessionAuth();
      const user = await getInternalUser(auth);
      const ownedProjects = await user.listOwnedProjects();
      for (const p of ownedProjects) {
        const target: ProjectTarget = p.isDevelopmentEnvironment ? "dev" : "cloud";
        if ((target === "cloud" && sources.cloud) || (target === "dev" && sources.dev)) {
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
