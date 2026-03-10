import { Command } from "commander";
import { removeConfigValue } from "../lib/config.js";

export function registerLogoutCommand(program: Command) {
  program
    .command("logout")
    .description("Log out of Stack Auth")
    .action(() => {
      removeConfigValue("STACK_CLI_REFRESH_TOKEN");
      console.log("Logged out successfully.");
    });
}
