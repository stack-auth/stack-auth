import { Command } from "commander";

export function registerLogoutCommand(program: Command) {
  program.command("logout").description("Log out of Hexclave").action(async () => {
    const { run } = await import("./logout.impl.js");
    await run();
  });
}
