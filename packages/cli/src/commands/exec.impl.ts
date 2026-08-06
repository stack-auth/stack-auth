import { isProjectAuthWithRefreshToken, resolveAuth, type ProjectAuthWithRefreshToken } from "../lib/auth.js";
import { resolveLocalDashboardAuthByConfigPath } from "../lib/local-dashboard-client.js";
import { getAdminProject } from "../lib/app.js";
import { CliError } from "../lib/errors.js";
import type { ExecTargetOpts } from "./exec.js";
import { parseExecTarget } from "./exec.js";

function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

export async function run(javascript: string | undefined, opts: ExecTargetOpts) {

  if (javascript === undefined) {
    throw new CliError("Missing JavaScript argument. Use `hexclave exec \"<javascript>\"` or `hexclave exec --help`.");
  }

  const target = parseExecTarget(opts);
  let auth: ProjectAuthWithRefreshToken;
  if (target.kind === "cloud") {
    const cloudAuth = resolveAuth(target.projectId);
    if (!isProjectAuthWithRefreshToken(cloudAuth)) {
      throw new CliError("`hexclave exec --cloud-project-id` requires `hexclave login`. Remove STACK_SECRET_SERVER_KEY and try again.");
    }
    auth = cloudAuth;
  } else {
    auth = await resolveLocalDashboardAuthByConfigPath(target.configFile);
  }
  const project = await getAdminProject(auth);

  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
  let fn;
  try {
    fn = new AsyncFunction("hexclaveServerApp", javascript);
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

}
