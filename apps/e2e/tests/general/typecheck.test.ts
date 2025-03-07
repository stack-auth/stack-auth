import { exec } from "child_process";
import { describe } from "vitest";
import { it } from "../helpers";

describe("`pnpm run typecheck`", () => {
  it("completes successfully", async ({ expect }) => {
    const [error, stdout, stderr] = await new Promise<[Error | null, string, string]>((resolve) => {
      exec("pnpm run typecheck", (error, stdout, stderr) => {
        resolve([error, stdout, stderr]);
      });
    });
    expect(error, `Expected no error to be thrown!\n\n\n\nstdout: ${stdout}\n\n\n\nstderr: ${stderr}`).toBeNull();
  }, 240_000);
});
