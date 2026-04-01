import { Command } from "commander";
import { StackClientApp } from "@stackframe/js";
import { resolveLoginConfig, DEFAULT_PUBLISHABLE_CLIENT_KEY } from "../lib/auth.js";
import { readConfigValue, writeConfigValue, removeConfigValue } from "../lib/config.js";
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

      const anonRefreshToken = readConfigValue("STACK_CLI_ANON_REFRESH_TOKEN");

      console.log("Waiting for browser authentication...");

      const result = await app.promptCliLogin({
        appUrl: config.dashboardUrl,
        anonRefreshToken,
        promptLink: (url) => {
          console.log(`\nPlease visit the following URL to authenticate:\n${url}`);
        },
      });

      if (result.status === "error") {
        throw new CliError(`Login failed: ${result.error.message}`);
      }

      writeConfigValue("STACK_CLI_REFRESH_TOKEN", result.data);
      if (anonRefreshToken) {
        removeConfigValue("STACK_CLI_ANON_REFRESH_TOKEN");
      }
      console.log("Login successful!");
    });
}
