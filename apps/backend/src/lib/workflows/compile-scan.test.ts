import { describe, expect, test } from "vitest";
import { getUsedStdlibPackages, scanWorkflowImports, validateWorkflowSource } from "./compile";

// Pure-function tests for the sync-time source validation (the esbuild
// bundling + sandbox manifest path is covered by the workflows e2e tests).

describe("scanWorkflowImports", () => {
  test("finds static imports, type imports, re-exports, dynamic imports, and requires", () => {
    const source = `
import { workflow } from "@hexclave/workflows";
import type { Step } from "@hexclave/workflows";
import { addDays } from "date-fns";
import addWeeks from "date-fns/addWeeks";
import "some-side-effect";
export { foo } from "./relative";
const x = await import("dynamic-pkg");
const y = require("required-pkg");
`;
    expect(scanWorkflowImports(source).sort()).toEqual([
      "./relative",
      "@hexclave/workflows",
      "date-fns",
      "date-fns/addWeeks",
      "dynamic-pkg",
      "required-pkg",
      "some-side-effect",
    ]);
  });
});

describe("validateWorkflowSource", () => {
  test("allows the contract package and the pinned stdlib (incl. subpaths)", () => {
    const result = validateWorkflowSource(`
import { workflow, hexclaveApp } from "@hexclave/workflows";
import { addDays } from "date-fns";
import addWeeks from "date-fns/addWeeks";
export default workflow("x", { on: ["user.created"] }, async () => {});
`);
    expect(result.status).toBe("ok");
  });

  test("rejects any other import with the self-contained error", () => {
    const result = validateWorkflowSource(`import fs from "fs";\nexport default 1;`);
    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.error).toContain("self-contained");
      expect(result.error).toContain('"fs"');
    }
  });

  test("rejects relative imports", () => {
    const result = validateWorkflowSource(`import { helper } from "./helper";\nexport default 1;`);
    expect(result.status).toBe("error");
  });

  test("rejects oversized sources with an explicit error (never truncation)", () => {
    const result = validateWorkflowSource("// filler\n".repeat(15_000));
    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.error).toContain("128 KiB");
    }
  });
});

describe("getUsedStdlibPackages", () => {
  test("detects date-fns usage incl. subpaths, ignores non-stdlib", () => {
    expect(getUsedStdlibPackages(`import { addDays } from "date-fns";`)).toEqual(["date-fns"]);
    expect(getUsedStdlibPackages(`import addWeeks from "date-fns/addWeeks";`)).toEqual(["date-fns"]);
    expect(getUsedStdlibPackages(`import { workflow } from "@hexclave/workflows";`)).toEqual([]);
  });
});
