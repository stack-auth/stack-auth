import { isValidConfig, normalize } from "./config/format";

export { showOnboardingHexclaveConfigValue } from "./hexclave-config-file";

const DEFAULT_CONFIG_IMPORT_PACKAGE = "@hexclave/js";

/**
 * Renders a config object into the source text of a `stack.config.ts` file.
 */
export function renderConfigFileContent(config: unknown, importPackage?: string): string {
  if (!isValidConfig(config)) {
    throw new Error("Invalid config: expected a plain object.");
  }

  const droppedKeys: string[] = [];
  const normalizedConfig = normalize(config, {
    onDotIntoNonObject: "ignore",
    onDotIntoNull: "empty-object",
    droppedKeys,
  });
  if (droppedKeys.length > 0) {
    throw new Error(`Config has conflicting keys that would be dropped during normalization: ${droppedKeys.map(k => JSON.stringify(k)).join(", ")}`);
  }
  const pkg = importPackage ?? DEFAULT_CONFIG_IMPORT_PACKAGE;
  // Import the `HexclaveConfig` type from the package's lightweight `/config`
  // entrypoint, which is free of framework runtime code and therefore safe for
  // tooling (e.g. the local dashboard) to load in a plain Node context. Only the
  // Hexclave-branded packages expose this subpath; legacy `@stackframe/*`
  // releases predate it, so fall back to their package root.
  const importSpecifier = pkg.startsWith("@hexclave/") ? `${pkg}/config` : pkg;
  const importLine = `import type { HexclaveConfig } from "${importSpecifier}";`;
  return `${importLine}\n\nexport const config: HexclaveConfig = ${JSON.stringify(normalizedConfig, null, 2)};\n`;
}

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
  "@hexclave/tanstack-start",
  "@hexclave/js",
  "@hexclave/template",
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

// `detectImportPackageFromDir` lives in `config-rendering-node.ts` to avoid
// pulling Node.js `fs`/`path` into browser bundles.

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
  expect(content).toContain('import type { HexclaveConfig } from "@hexclave/next/config";');
});

import.meta.vitest?.test("renderConfigFileContent defaults to @hexclave/js", ({ expect }) => {
  const content = renderConfigFileContent({});
  expect(content).toContain('import type { HexclaveConfig } from "@hexclave/js/config";');
});

import.meta.vitest?.test("renderConfigFileContent keeps legacy @stackframe packages on their root entrypoint", ({ expect }) => {
  // The lightweight `/config` subpath only exists on Hexclave-branded packages;
  // already-published @stackframe/* releases predate it.
  const content = renderConfigFileContent({}, "@stackframe/next");
  expect(content).toContain('import type { HexclaveConfig } from "@stackframe/next";');
});

import.meta.vitest?.test("detectConfigImportPackage picks first matching package by priority", ({ expect }) => {
  expect(detectConfigImportPackage(["@hexclave/next", "@hexclave/js"])).toBe("@hexclave/next");
  expect(detectConfigImportPackage(["@hexclave/react", "@hexclave/js"])).toBe("@hexclave/react");
  expect(detectConfigImportPackage(["@hexclave/js"])).toBe("@hexclave/js");
  expect(detectConfigImportPackage(["@hexclave/tanstack-start"])).toBe("@hexclave/tanstack-start");
  // Hexclave names take priority over legacy stackframe names when both appear.
  expect(detectConfigImportPackage(["@stackframe/stack", "@hexclave/next"])).toBe("@hexclave/next");
  // Legacy fallback still works for projects pinned to the last @stackframe/* release.
  expect(detectConfigImportPackage(["@stackframe/stack"])).toBe("@stackframe/stack");
  expect(detectConfigImportPackage(["@stackframe/template"])).toBe("@stackframe/template");
  expect(detectConfigImportPackage(["lodash", "express"])).toBeUndefined();
  expect(detectConfigImportPackage([])).toBeUndefined();
});
