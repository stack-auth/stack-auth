import { Command } from "commander";

export function registerDoctorCommand(program: Command) {
  program.command("doctor").description("Check that Hexclave is correctly wired up in your project").option("--output-dir <dir>", "Project root to inspect (defaults to cwd)").option("--framework <fw>", "Override framework detection (next | react | js)").option("--json", "Emit a machine-readable JSON report").action(async (opts) => {
    const { run } = await import("./doctor.impl.js");
    await run(program, opts);
  });
}
