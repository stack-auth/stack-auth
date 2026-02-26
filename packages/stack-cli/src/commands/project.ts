import { Command } from "commander";
import * as readline from "readline";
import { resolveSessionAuth } from "../lib/auth.js";
import { getInternalUser } from "../lib/app.js";
import { isNonInteractiveEnv } from "../lib/interactive.js";
import { CliError } from "../lib/errors.js";

function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

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

      let displayName: string = opts.displayName;
      if (!displayName) {
        if (isNonInteractiveEnv()) {
          throw new CliError("--display-name is required in non-interactive environments (CI).");
        }
        displayName = await prompt("Project display name: ");
        if (!displayName.trim()) {
          throw new CliError("Display name cannot be empty.");
        }
      }

      const teams = await user.listTeams();
      if (teams.length === 0) {
        throw new CliError("No teams found. You need a team to create a project.");
      }

      const newProject = await user.createProject({
        displayName,
        teamId: teams[0].id,
      });

      if (program.opts().json) {
        console.log(JSON.stringify({ id: newProject.id, displayName: newProject.displayName }, null, 2));
      } else {
        console.log(`Project created: ${newProject.id} (${newProject.displayName})`);
      }
    });
}
