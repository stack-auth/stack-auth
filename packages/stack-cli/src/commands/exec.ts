import { Command } from "commander";
import { isProjectAuthWithRefreshToken, resolveAuth } from "../lib/auth.js";
import { getAdminProject } from "../lib/app.js";
import { CliError } from "../lib/errors.js";

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
    .addHelpText("after", "\nFor available API methods, see: https://docs.stack-auth.com/docs/sdk")
    .action(async (javascript: string | undefined) => {
      if (javascript === undefined) {
        throw new CliError("Missing JavaScript argument. Use `stack exec \"<javascript>\"` or `stack exec --help`.");
      }

      const flags = program.opts();
      const auth = resolveAuth(flags);
      if (!isProjectAuthWithRefreshToken(auth)) {
        throw new CliError("`stack exec` requires `stack login`. Remove STACK_SECRET_SERVER_KEY and try again.");
      }
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
