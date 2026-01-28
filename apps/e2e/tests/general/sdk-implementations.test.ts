import { exec } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { describe } from "vitest";
import { it } from "../helpers";

// Find all SDK implementations that have a package.json
function findSdkImplementations(): string[] {
  const implementationsDir = path.resolve(__dirname, "../../../../sdks/implementations");

  if (!fs.existsSync(implementationsDir)) {
    return [];
  }

  const entries = fs.readdirSync(implementationsDir, { withFileTypes: true });
  const sdkDirs: string[] = [];

  for (const entry of entries) {
    if (entry.isDirectory()) {
      const packageJsonPath = path.join(implementationsDir, entry.name, "package.json");
      if (fs.existsSync(packageJsonPath)) {
        sdkDirs.push(entry.name);
      }
    }
  }

  return sdkDirs;
}

const sdkImplementations = findSdkImplementations();

describe("SDK implementation tests", () => {
  for (const sdk of sdkImplementations) {
    describe(`${sdk} SDK`, () => {
      it("runs tests successfully", async ({ expect }) => {
        const sdkDir = path.resolve(__dirname, `../../../../sdks/implementations/${sdk}`);

        const [error, stdout, stderr] = await new Promise<[Error | null, string, string]>((resolve) => {
          exec("pnpm run test", { cwd: sdkDir }, (error, stdout, stderr) => {
            resolve([error, stdout, stderr]);
          });
        });

        expect(
          error,
          `Expected ${sdk} SDK tests to pass!\n\n\n\nstdout: ${stdout}\n\n\n\nstderr: ${stderr}`
        ).toBeNull();
      }, 300_000); // 5 minute timeout for SDK tests
    });
  }

  // If no SDKs found, add a placeholder test so the describe block isn't empty
  if (sdkImplementations.length === 0) {
    it("has no SDK implementations to test", ({ expect }) => {
      expect(true).toBe(true);
    });
  }
});
