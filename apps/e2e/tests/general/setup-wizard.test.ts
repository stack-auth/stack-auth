import { describe } from "vitest";
import { it, runCommand } from "../helpers";

describe("Setup wizard", () => {
  it("completes successfully", async ({ expect }) => {
    const { error, stdout, stderr } = await runCommand`pnpm -C packages/init-stack run test-run`;
    expect(error, `Expected no error to be thrown!\n\n\n\nstdout: ${stdout}\n\n\n\nstderr: ${stderr}`).toBeNull();
  }, 240_000);
});
