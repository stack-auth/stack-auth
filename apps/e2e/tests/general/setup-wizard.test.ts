import { exec } from "child_process";
import { describe } from "vitest";
import { it } from "../helpers";

describe("Setup wizard", () => {
  // this test is opt-in and should only run when explicitly enabled
  it.runIf(process.env.STACK_RUN_SETUP_WIZARD_TESTS === "true")("completes successfully", async ({ expect }) => {
    const [error, stdout, stderr] = await new Promise<[Error | null, string, string]>((resolve) => {
      exec("pnpm -C packages/init-stack run test-run", (error, stdout, stderr) => {
        resolve([error, stdout, stderr]);
      });
    });
    expect(error, `Expected no error to be thrown!\n\n\n\nstdout: ${stdout}\n\n\n\nstderr: ${stderr}`).toBeNull();
  }, 240_000);
});
