import { Command } from "commander";
import { StackClientApp } from "@stackframe/js";
import { resolveLoginConfig, DEFAULT_PUBLISHABLE_CLIENT_KEY } from "../lib/auth.js";
import { writeConfigValue } from "../lib/config.js";
import { CliError } from "../lib/errors.js";

export function registerLoginCommand(program: Command) {
  program
    .command("login")
    .description("Log in to Stack Auth via browser")
    .action(async () => {
      const flags = program.opts();
      const config = resolveLoginConfig(flags);

      const app = new StackClientApp({
        projectId: "internal",
        publishableClientKey: DEFAULT_PUBLISHABLE_CLIENT_KEY,
        baseUrl: config.apiUrl,
        tokenStore: "memory",
        noAutomaticPrefetch: true,
      });

      console.log("Waiting for browser authentication...");

      const result = await app.promptCliLogin({
        appUrl: config.dashboardUrl,
      });

      if (result.status === "error") {
        throw new CliError(`Login failed: ${result.error.message}`);
      }

      writeConfigValue("STACK_CLI_REFRESH_TOKEN", result.data);
      console.log("Login successful!");
    });
}
