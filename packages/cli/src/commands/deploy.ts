import { Command } from "commander";
import type { DeployOptions } from "../lib/deploy-config.js";

export function registerDeployCommand(program: Command) {
  program
    .command("deploy <service>")
    .description("Deploy a service defined under `deployments-alpha.services` in your hexclave.config.ts. Uploads the service's source directory, waits for Vercel to accept the deployment, then prints the run id without waiting for the remote build to finish.")
    .option("--config <path>", "Path to the config file (default: auto-discover hexclave.config.ts in the current directory)")
    .option("--cloud-project-id <id>", "Hexclave project ID to deploy to (defaults to the HEXCLAVE_PROJECT_ID env var)")
    .option("--secret <KEY=VALUE>", "Value for a secret env var of this deploy (repeatable). KEY is the secret key named by a `type: \"secret\"` env var in the config; the value is pushed to the deployment target and never persisted by Hexclave.", (value: string, previous: string[]) => [...previous, value], [] as string[])
    .addHelpText("after", "\nAuthentication: uses HEXCLAVE_SECRET_SERVER_KEY if set (recommended for CI), otherwise your `hexclave login` session.")
    .action(async (service: string, opts: DeployOptions) => {
      const { runDeploy } = await import("./deploy.impl.js");
      await runDeploy(service, opts);
    });
}
