import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { internalPckPath, pollInternalPck } from "./emulator-paths.js";

describe("pollInternalPck", () => {
  const SAVED_HOME = process.env.STACK_EMULATOR_HOME;
  let tmpHome: string;

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "stack-cli-poll-pck-"));
    process.env.STACK_EMULATOR_HOME = tmpHome;
  });
  afterEach(() => {
    if (SAVED_HOME === undefined) delete process.env.STACK_EMULATOR_HOME;
    else process.env.STACK_EMULATOR_HOME = SAVED_HOME;
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  function writePck(contents: string): void {
    const pckPath = internalPckPath();
    fs.mkdirSync(path.dirname(pckPath), { recursive: true });
    fs.writeFileSync(pckPath, contents);
  }

  it("returns trimmed contents when the file already exists", async () => {
    writePck("  pck_existing  \n");
    const result = await pollInternalPck(50);
    expect(result).toBe("pck_existing");
  });

  it("returns null when the deadline elapses with no file", async () => {
    const start = Date.now();
    const result = await pollInternalPck(0);
    expect(result).toBeNull();
    // 0ms budget should resolve almost instantly.
    expect(Date.now() - start).toBeLessThan(500);
  });

  it("treats an empty/whitespace-only file as not-yet-ready and times out null", async () => {
    writePck("   \n");
    const result = await pollInternalPck(0);
    expect(result).toBeNull();
  });

  it("picks up the file if it appears mid-poll", async () => {
    setTimeout(() => writePck("pck_appears_late"), 80);
    const result = await pollInternalPck(2000);
    expect(result).toBe("pck_appears_late");
  });

  it("propagates non-ENOENT read errors", async () => {
    // Create a directory at the PCK path so readFileSync throws EISDIR.
    const pckPath = internalPckPath();
    fs.mkdirSync(pckPath, { recursive: true });
    await expect(pollInternalPck(50)).rejects.toThrow();
  });
});
