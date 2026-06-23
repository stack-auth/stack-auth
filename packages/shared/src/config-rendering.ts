import { existsSync, readFileSync } from "fs";
import { createJiti } from "jiti";
import path from "path";
import { isValidConfig, normalize } from "./config/format";
import { hexclaveConfigFileExportsConfig } from "./hexclave-config-file";
export { hexclaveConfigFileExportsConfig };

const DEFAULT_CONFIG_IMPORT_PACKAGE = "@hexclave/js";

const jiti = createJiti(import.meta.url, { moduleCache: false });

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
  const importSpecifier = pkg.startsWith("@hexclave/") ? `${pkg}/config` : pkg;
  const importLine = `import type { HexclaveConfig } from "${importSpecifier}";`;
  return `${importLine}\n\nexport const config: HexclaveConfig = ${JSON.stringify(normalizedConfig, null, 2)};\n`;
}

type ParsedConfigValue = Record<string, unknown> | string;

/**
 * Evaluates config file content using jiti and returns the exported `config`
 * value. Replaces the old Babel AST-based `parseHexclaveConfigFileContent`.
 */
export function evalConfigFileContent(content: string, filePath: string): ParsedConfigValue {
  if (content.trim() === "") return {};
  const resolvedPath = path.isAbsolute(filePath) ? filePath : path.resolve(filePath);
  const mod = jiti.evalModule(content, { filename: resolvedPath }) as Record<string, unknown>;
  const config = mod.config;
  if (config === undefined) {
    throw new Error(`Invalid config in ${filePath}. The file must export a plain \`config\` object or "show-onboarding".`);
  }
  if (typeof config === "string") return config;
  if (config !== null && typeof config === "object" && !Array.isArray(config)) {
    return config as Record<string, unknown>;
  }
  throw new Error(`Invalid config in ${filePath}. The file must export a plain \`config\` object or "show-onboarding".`);
}

/**
 * Like {@link evalConfigFileContent}, but returns `null` instead of throwing
 * when the content cannot be evaluated.
 */
export function tryEvalConfigFileContent(content: string, filePath: string): ParsedConfigValue | null {
  try {
    return evalConfigFileContent(content, filePath);
  } catch {
    return null;
  }
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

import.meta.vitest?.test("evalConfigFileContent parses static config exports", ({ expect }) => {
  expect(evalConfigFileContent(`
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

import.meta.vitest?.test("evalConfigFileContent parses show-onboarding", ({ expect }) => {
  expect(evalConfigFileContent('export const config = "show-onboarding";', "stack.config.ts")).toBe("show-onboarding");
});

import.meta.vitest?.test("evalConfigFileContent rejects content without config export", ({ expect }) => {
  expect(() => evalConfigFileContent("export const other = {};", "stack.config.ts")).toThrow(/must export/);
});

import.meta.vitest?.test("tryEvalConfigFileContent returns the config for valid exports", ({ expect }) => {
  expect(tryEvalConfigFileContent("export const config = { auth: { allowSignUp: true } };", "stack.config.ts")).toEqual({
    auth: { allowSignUp: true },
  });
});

import.meta.vitest?.test("tryEvalConfigFileContent returns null on failure", ({ expect }) => {
  expect(tryEvalConfigFileContent("export const config = {", "stack.config.ts")).toBeNull();
});

import.meta.vitest?.test("hexclaveConfigFileExportsConfig detects a config export", ({ expect }) => {
  expect(hexclaveConfigFileExportsConfig("export const config = { a: 1 };", "stack.config.ts")).toBe(true);
  expect(hexclaveConfigFileExportsConfig('import x from "./x.txt" with { type: "text" };\nexport const config = { a: x };', "stack.config.ts")).toBe(true);
  expect(hexclaveConfigFileExportsConfig("export const notConfig = { a: 1 };", "stack.config.ts")).toBe(false);
  expect(hexclaveConfigFileExportsConfig("export const config = {", "stack.config.ts")).toBe(false);
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
