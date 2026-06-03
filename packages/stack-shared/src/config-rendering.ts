import { existsSync, readFileSync } from "fs";
import path from "path";
import { parseStackConfigFileContent, renderConfigFileContent } from "./hexclave-config-file";
export { parseStackConfigFileContent, renderConfigFileContent };

/**
 * Packages that export the `HexclaveConfig` type, in priority order.
 * The first match found in a project's dependencies wins. Hexclave-branded
 * packages come first (canonical); the legacy `@stackframe/*` names remain
 * so projects pinned to the last legacy release still render a config file
 * that compiles against their installed SDK.
 */
const CONFIG_IMPORT_PACKAGES = [
  "@hexclave/next",
  "@hexclave/react",
  "@hexclave/js",
  "@stackframe/stack",
  "@stackframe/react",
  "@stackframe/js",
  "@stackframe/template",
] as const;

/**
 * Given a list of dependency names (from package.json), returns the SDK
 * package that should be used for the `HexclaveConfig` import, or `undefined`
 * if none of the known packages are installed.
 */
export function detectConfigImportPackage(dependencies: string[]): string | undefined {
  for (const pkg of CONFIG_IMPORT_PACKAGES) {
    if (dependencies.includes(pkg)) {
      return pkg;
    }
  }
  return undefined;
}

/**
 * Walks up from `dir` to find the nearest `package.json` and returns the
 * best SDK package to use for the `HexclaveConfig` type import.
 */
export function detectImportPackageFromDir(dir: string): string | undefined {
  let current = dir;
  while (true) {
    const pkgPath = path.join(current, "package.json");
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
        const deps = [
          ...Object.keys(pkg.dependencies ?? {}),
          ...Object.keys(pkg.devDependencies ?? {}),
        ];
        return detectConfigImportPackage(deps);
      } catch {
        return undefined;
      }
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return undefined;
}

import.meta.vitest?.test("renderConfigFileContent normalizes config exports", ({ expect }) => {
  expect(renderConfigFileContent({
    "payments.items.todos.displayName": "Todo Slots",
    "payments.items.todos.customerType": "user",
  })).toContain(`export const config: HexclaveConfig = {
  "payments": {
    "items": {
      "todos": {
        "displayName": "Todo Slots",
        "customerType": "user"
      }
    }
  }
};`);
});

import.meta.vitest?.test("parseStackConfigFileContent parses static config exports", ({ expect }) => {
  expect(parseStackConfigFileContent(`
    import type { StackConfig } from "@hexclave/js";
    export const config: StackConfig = {
      auth: { allowSignUp: true },
      payments: { testMode: false },
    };
  `, "stack.config.ts")).toMatchInlineSnapshot(`
    {
      "auth": {
        "allowSignUp": true,
      },
      "payments": {
        "testMode": false,
      },
    }
  `);
});

import.meta.vitest?.test("parseStackConfigFileContent parses show-onboarding", ({ expect }) => {
  expect(parseStackConfigFileContent('export const config = "show-onboarding";', "stack.config.ts")).toBe("show-onboarding");
});

import.meta.vitest?.test("parseStackConfigFileContent rejects dynamic config exports", ({ expect }) => {
  expect(() => parseStackConfigFileContent("export const config = makeConfig();", "stack.config.ts")).toThrow(/Unsupported config expression/);
});

import.meta.vitest?.test("renderConfigFileContent rejects conflicting dotted keys", ({ expect }) => {
  expect(() => renderConfigFileContent({
    "a.b": 1,
    "a.b.c": 2,
  })).toThrowError(/conflicting keys.*"a\.b\.c"/);
});

import.meta.vitest?.test("renderConfigFileContent rejects invalid config exports", ({ expect }) => {
  expect(() => renderConfigFileContent(null)).toThrowErrorMatchingInlineSnapshot(
    `[Error: Invalid config: expected a plain object.]`,
  );
});

import.meta.vitest?.test("renderConfigFileContent uses custom import package", ({ expect }) => {
  const content = renderConfigFileContent({}, "@hexclave/next");
  expect(content).toContain('import type { HexclaveConfig } from "@hexclave/next";');
});

import.meta.vitest?.test("renderConfigFileContent defaults to @hexclave/js", ({ expect }) => {
  const content = renderConfigFileContent({});
  expect(content).toContain('import type { HexclaveConfig } from "@hexclave/js";');
});

import.meta.vitest?.test("detectConfigImportPackage picks first matching package by priority", ({ expect }) => {
  expect(detectConfigImportPackage(["@hexclave/next", "@hexclave/js"])).toBe("@hexclave/next");
  expect(detectConfigImportPackage(["@hexclave/react", "@hexclave/js"])).toBe("@hexclave/react");
  expect(detectConfigImportPackage(["@hexclave/js"])).toBe("@hexclave/js");
  // Hexclave names take priority over legacy stackframe names when both appear.
  expect(detectConfigImportPackage(["@stackframe/stack", "@hexclave/next"])).toBe("@hexclave/next");
  // Legacy fallback still works for projects pinned to the last @stackframe/* release.
  expect(detectConfigImportPackage(["@stackframe/stack"])).toBe("@stackframe/stack");
  expect(detectConfigImportPackage(["@stackframe/template"])).toBe("@stackframe/template");
  expect(detectConfigImportPackage(["lodash", "express"])).toBeUndefined();
  expect(detectConfigImportPackage([])).toBeUndefined();
});
