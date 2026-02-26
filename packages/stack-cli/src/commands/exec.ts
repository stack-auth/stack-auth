import { Command } from "commander";
import { resolveAuth } from "../lib/auth.js";
import { getAdminProject } from "../lib/app.js";
import { CliError } from "../lib/errors.js";

export function registerExecCommand(program: Command) {
  program
    .command("exec <javascript>")
    .description("Execute JavaScript with a pre-configured StackServerApp as `app`")
    .action(async (javascript: string) => {
      const flags = program.opts();
      const auth = resolveAuth(flags);
      const project = await getAdminProject(auth);

      // eslint-disable-next-line @typescript-eslint/no-implied-eval
      const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
      let fn;
      try {
        fn = new AsyncFunction("app", javascript);
      } catch (err: any) {
        throw new CliError(`Syntax error in exec code: ${err.message}`);
      }
      let result;
      try {
        result = await fn(project.app);
      } catch (err: any) {
        throw new CliError(`Exec error: ${err.message}`);
      }

      if (result !== undefined) {
        console.log(JSON.stringify(result, null, 2));
      }
    });
}
