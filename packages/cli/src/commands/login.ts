import { Command } from "commander";

// Keep command metadata eager for help output; load the implementation only when invoked.
export function registerLoginCommand(program: Command) {
  program.command("login").description("Log in to Hexclave via browser. To attach this login to an existing anonymous session, set STACK_CLI_ANON_REFRESH_TOKEN (env var) or the same key in the CLI credentials file before running; login does not write that value.").action(async () => {
    const { run } = await import("./login.impl.js");
    await run();
  });
}
