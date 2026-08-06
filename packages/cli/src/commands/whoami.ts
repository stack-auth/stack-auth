import { Command } from "commander";

export function registerWhoamiCommand(program: Command) {
  program.command("whoami").description("Show the currently logged-in Hexclave CLI user").action(async () => {
    const { run } = await import("./whoami.impl.js");
    await run(program);
  });
}
