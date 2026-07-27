import { describe, expect, test } from "vitest";
import { compileWorkflowBundle, getUsedStdlibPackages, scanWorkflowImports, validateWorkflowManifest, validateWorkflowSource } from "./compile";
import { getWorkflowsRuntimeEnv, WORKFLOWS_CURRENT_RUNTIME_ENV_VERSION } from "./runtime-env";
import { WORKFLOWS_RUNTIME_PACKAGE_SOURCE } from "./runtime-source";

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

  test("rejects minified static imports and re-exports without whitespace", () => {
    for (const source of [
      `import{readFileSync}from"node:fs";export default 1;`,
      `export{readFileSync}from"node:fs";`,
    ]) {
      const result = validateWorkflowSource(source);
      expect(result.status).toBe("error");
      if (result.status === "error") expect(result.error).toContain('"node:fs"');
    }
  });

  test("enforces the allowlist through esbuild module resolution", async () => {
    // The quote is inside a comment and deliberately confuses the
    // best-effort source scanner; esbuild still parses and canonicalizes it.
    const result = await compileWorkflowBundle(`import/*"*/{HexclaveAdminApp}from"@hexclave/js";export default HexclaveAdminApp;`);
    expect(result.status).toBe("error");
    if (result.status === "error") expect(result.error).toContain("@hexclave/js");
  });

  test("rejects attempts to import or embed the trusted runtime module marker", async () => {
    for (const source of [
      `if (false) {} import/*"*/{ HexclaveAdminApp }from"@hexclave/workflows-internal-admin-runtime"; export default HexclaveAdminApp;`,
      `export default "@hexclave/workflows-internal-admin-runtime";`,
    ]) {
      const result = await compileWorkflowBundle(source);
      expect(result.status).toBe("error");
      if (result.status === "error") expect(result.error).toContain("reserved internal module marker");
    }
  });

  test("rejects non-literal module loading that could bypass the import allowlist", () => {
    for (const source of [
      `const moduleName = "node:fs"; await import(moduleName);`,
      `await import("node:" + "fs");`,
      `const moduleName = "node:fs"; require(moduleName);`,
    ]) {
      const result = validateWorkflowSource(source);
      expect(result.status).toBe("error");
      if (result.status === "error") expect(result.error).toContain("not supported");
    }
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

describe("workflow runtime dependencies", () => {
  test("pins the published Hexclave AdminApp package", () => {
    expect(getWorkflowsRuntimeEnv(WORKFLOWS_CURRENT_RUNTIME_ENV_VERSION).runtimeNodeModules).toEqual({
      "@hexclave/js": "1.0.52",
    });
  });

  test("keeps the real admin SDK as a sandbox-resolved import", async () => {
    const result = await compileWorkflowBundle(`
import { workflow } from "@hexclave/workflows";
export default workflow("x", { on: ["user.created"] }, async () => {});
`);
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.data.compiledBundle).toContain("@hexclave/js");
      expect(result.data.compiledBundle).toContain("HexclaveAdminApp");
    }
  });

  test("constructs the inert manifest AdminApp with the reserved internal project ID", () => {
    expect(WORKFLOWS_RUNTIME_PACKAGE_SOURCE).toContain('projectId: appCredentials?.projectId ?? "internal"');
    expect(WORKFLOWS_RUNTIME_PACKAGE_SOURCE).not.toContain('projectId: appCredentials?.projectId ?? "workflow-manifest"');
  });
});

describe("validateWorkflowManifest", () => {
  test("rejects custom triggers the event sender can never emit", () => {
    for (const eventType of ["custom.contains whitespace", `custom.${"x".repeat(201)}`]) {
      const result = validateWorkflowManifest({
        workflowId: "invalid-trigger",
        triggers: [{ type: "event", eventType }],
        hasRunKey: false,
        onConflict: "skip",
      }, "invalid-trigger");
      expect(result.status).toBe("error");
    }
  });
});
