import { mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { describe, expect, it, vi } from "vitest";
import { watchConfigFile } from "./config-file-watcher";

describe("watchConfigFile", () => {
  it("continues reporting changes after atomic file replacements", async () => {
    const directory = mkdtempSync(join(tmpdir(), "stack-config-watcher-test.untracked-"));
    const configFilePath = join(directory, "stack.config.ts");
    writeFileSync(configFilePath, "initial");

    const observedContents: string[] = [];
    const watcher = watchConfigFile(configFilePath, () => {
      observedContents.push(readFileSync(configFilePath, "utf-8"));
    });

    const replaceConfig = (content: string) => {
      const replacementPath = join(directory, "stack.config.replacement.untracked.tmp");
      writeFileSync(replacementPath, content);
      renameSync(replacementPath, configFilePath);
    };

    try {
      // fs.watch does not expose a ready event. Observe one ordinary write so
      // the assertions below test replacement behavior rather than startup.
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
      writeFileSync(configFilePath, "watcher ready");
      await vi.waitFor(() => {
        expect(observedContents).toContain("watcher ready");
      });

      replaceConfig("first replacement");
      await vi.waitFor(() => {
        expect(observedContents).toContain("first replacement");
      });

      replaceConfig("second replacement");
      await vi.waitFor(() => {
        expect(observedContents).toContain("second replacement");
      });
    } finally {
      watcher.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
