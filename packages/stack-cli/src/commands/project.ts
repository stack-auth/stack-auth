import { Command } from "commander";
import { resolveSessionAuth } from "../lib/auth.js";
import { getInternalUser } from "../lib/app.js";
import { createProjectInteractively } from "../lib/create-project.js";

export function registerProjectCommand(program: Command) {
  const project = program
    .command("project")
    .description("Manage projects");

  project
    .command("list")
    .description("List your owned projects")
    .action(async () => {
      const flags = program.opts();
      const auth = resolveSessionAuth(flags);
      const user = await getInternalUser(auth);
      const projects = await user.listOwnedProjects();

      if (program.opts().json) {
        console.log(JSON.stringify(projects.map((p) => ({ id: p.id, displayName: p.displayName })), null, 2));
      } else {
        if (projects.length === 0) {
          console.log("No projects found.");
          return;
        }
        for (const p of projects) {
          console.log(`${p.id}\t${p.displayName}`);
        }
      }
    });

  project
    .command("create")
    .description("Create a new project")
    .option("--display-name <name>", "Project display name")
    .action(async (opts) => {
      const flags = program.opts();
      const auth = resolveSessionAuth(flags);
      const user = await getInternalUser(auth);

      const newProject = await createProjectInteractively(user, {
        displayName: opts.displayName,
      });

      if (program.opts().json) {
        console.log(JSON.stringify({ id: newProject.id, displayName: newProject.displayName }, null, 2));
      } else {
        console.log(`Project created: ${newProject.id} (${newProject.displayName})`);
      }
    });
}
