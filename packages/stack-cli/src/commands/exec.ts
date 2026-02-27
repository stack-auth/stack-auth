import { Command } from "commander";
import { resolveAuth } from "../lib/auth.js";
import { getAdminProject } from "../lib/app.js";
import { CliError } from "../lib/errors.js";
import { formatExecApiHelp } from "../lib/exec-api.js";

function getErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  if (typeof err === "string") {
    return err;
  }
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

export function registerExecCommand(program: Command) {
  program
    .command("exec [javascript]")
    .description("Execute JavaScript with a pre-configured StackServerApp as `stackServerApp`")
    .option("--list-api", "List callable methods available on the `stackServerApp` object")
    .action(async (javascript: string | undefined, options: { listApi?: boolean }) => {
      const { listApi } = options;
      if (listApi === true && javascript !== undefined) {
        throw new CliError("Cannot pass JavaScript when using --list-api.");
      }
      if (listApi === true) {
        try {
          console.log(formatExecApiHelp());
          return;
        } catch (err: unknown) {
          throw new CliError(`Failed to load exec API metadata. Run \`pnpm --filter @stackframe/stack-cli run generate:exec-api-metadata\` and rebuild the CLI. Root cause: ${getErrorMessage(err)}`);
        }
      }
      if (javascript === undefined) {
        throw new CliError("Missing JavaScript argument. Use `stack exec \"<javascript>\"` or `stack exec --list-api`.");
      }

      const flags = program.opts();
      const auth = resolveAuth(flags);
      const project = await getAdminProject(auth);

      // eslint-disable-next-line @typescript-eslint/no-implied-eval
      const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
      let fn;
      try {
        fn = new AsyncFunction("stackServerApp", javascript);
      } catch (err: unknown) {
        throw new CliError(`Syntax error in exec code: ${getErrorMessage(err)}`);
      }
      let result;
      try {
        result = await fn(project.app);
      } catch (err: unknown) {
        throw new CliError(`Exec error: ${getErrorMessage(err)}`);
      }

      if (result !== undefined) {
        console.log(JSON.stringify(result, null, 2));
      }
    });
}
