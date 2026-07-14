import { Command } from "commander";
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
  const project = program.command("project").description("Manage projects");
  project.command("list").description("List your projects (defaults to both cloud and development-environment projects)").option("--cloud", "Only list cloud projects").option("--local", "Only list development-environment projects").action(async (opts: ProjectListFlags) => {
    const { runList } = await import("./project.impl.js");
    await runList(program, opts);
  });
  project.command("create").description("Create a new cloud project").option("--cloud", "Confirm that this creates a cloud project").option("--display-name <name>", "Project display name").action(async (opts) => {
    const { runCreate } = await import("./project.impl.js");
    await runCreate(program, opts);
  });
}
