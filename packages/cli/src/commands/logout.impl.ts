import { removeConfigValue } from "../lib/config.js";

export async function run() {
  removeConfigValue("STACK_CLI_REFRESH_TOKEN");
  console.log("Logged out successfully.");
}
