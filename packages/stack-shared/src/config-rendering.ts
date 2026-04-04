import { existsSync, readFileSync } from "fs";
import path from "path";
import { isValidConfig, normalize } from "./config/format";

/**
 * Packages that export the `StackConfig` type, in priority order.
 * The first match found in a project's dependencies wins.
 */
const STACKFRAME_CONFIG_PACKAGES = [
  "@stackframe/stack",
  "@stackframe/react",
  "@stackframe/js",
  "@stackframe/template",
] as const;

const DEFAULT_CONFIG_IMPORT_PACKAGE = "@stackframe/js";

/**
 * Given a list of dependency names (from package.json), returns the
 * `@stackframe/*` package that should be used for the `StackConfig` import,
 * or `undefined` if none of the known packages are installed.
 */
export function detectStackframeImportPackage(dependencies: string[]): string | undefined {
  for (const pkg of STACKFRAME_CONFIG_PACKAGES) {
    if (dependencies.includes(pkg)) {
      return pkg;
    }
  }
  return undefined;
}

/**
 * Walks up from `dir` to find the nearest `package.json` and returns the
 * best `@stackframe/*` package to use for the `StackConfig` type import.
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
        return detectStackframeImportPackage(deps);
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
  const importLine = `import type { StackConfig } from "${pkg}";`;
  return `${importLine}\n\nexport const config: StackConfig = ${JSON.stringify(normalizedConfig, null, 2)};\n`;
}

import.meta.vitest?.test("renderConfigFileContent normalizes config exports", ({ expect }) => {
  expect(renderConfigFileContent({
    "payments.items.todos.displayName": "Todo Slots",
    "payments.items.todos.customerType": "user",
  })).toContain(`export const config: StackConfig = {
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
  const content = renderConfigFileContent({}, "@stackframe/stack");
  expect(content).toContain('import type { StackConfig } from "@stackframe/stack";');
});

import.meta.vitest?.test("renderConfigFileContent defaults to @stackframe/js", ({ expect }) => {
  const content = renderConfigFileContent({});
  expect(content).toContain('import type { StackConfig } from "@stackframe/js";');
});

import.meta.vitest?.test("detectStackframeImportPackage picks first matching package by priority", ({ expect }) => {
  expect(detectStackframeImportPackage(["@stackframe/stack", "@stackframe/js"])).toBe("@stackframe/stack");
  expect(detectStackframeImportPackage(["@stackframe/react", "@stackframe/js"])).toBe("@stackframe/react");
  expect(detectStackframeImportPackage(["@stackframe/js"])).toBe("@stackframe/js");
  expect(detectStackframeImportPackage(["@stackframe/template"])).toBe("@stackframe/template");
  expect(detectStackframeImportPackage(["lodash", "express"])).toBeUndefined();
  expect(detectStackframeImportPackage([])).toBeUndefined();
});
