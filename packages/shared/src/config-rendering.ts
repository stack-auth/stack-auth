import * as babelParser from "@babel/parser";
import * as t from "@babel/types";
import { isValidConfig, normalize } from "./config/format";

const DEFAULT_CONFIG_IMPORT_PACKAGE = "@hexclave/js";

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Statically evaluates a Babel AST node representing a JSON-like literal
 * (objects, arrays, strings, numbers, booleans, null). Returns `undefined`
 * for nodes that can't be resolved without execution (function calls,
 * identifiers, template literals, etc.).
 */
function evaluateLiteralNode(node: t.Node): unknown {
  // Unwrap TS type assertions so `{ ... } satisfies T` / `{ ... } as const` resolve.
  if (t.isTSAsExpression(node) || t.isTSSatisfiesExpression(node)) {
    return evaluateLiteralNode(node.expression);
  }
  if (t.isObjectExpression(node)) {
    const result: Record<string, unknown> = {};
    for (const prop of node.properties) {
      if (t.isSpreadElement(prop) || !t.isObjectProperty(prop)) return undefined;
      if (prop.computed) return undefined;
      const key = t.isIdentifier(prop.key)
        ? prop.key.name
        : t.isStringLiteral(prop.key)
          ? prop.key.value
          : t.isNumericLiteral(prop.key)
            ? String(prop.key.value)
            : undefined;
      if (key === undefined) return undefined;
      const value = evaluateLiteralNode(prop.value);
      if (value === undefined) return undefined;
      result[key] = value;
    }
    return result;
  }
  if (t.isArrayExpression(node)) {
    const result: unknown[] = [];
    for (const element of node.elements) {
      if (element == null || t.isSpreadElement(element)) return undefined;
      const value = evaluateLiteralNode(element);
      if (value === undefined) return undefined;
      result.push(value);
    }
    return result;
  }
  if (t.isStringLiteral(node)) return node.value;
  if (t.isNumericLiteral(node)) return node.value;
  if (t.isBooleanLiteral(node)) return node.value;
  if (t.isNullLiteral(node)) return null;
  if (t.isUnaryExpression(node) && node.operator === "-" && t.isNumericLiteral(node.argument)) {
    return -node.argument.value;
  }
  return undefined;
}

/**
 * Parses a config file and extracts the exported `config` value by statically
 * evaluating the AST. Handles both JSON-formatted and JavaScript object literal
 * syntax (unquoted keys, trailing commas). Never executes code, so it is safe
 * for untrusted input such as content fetched from a remote repository.
 *
 * Returns:
 * - `Record<string, unknown>` when the config exports an object literal
 * - `string` when the config exports a string literal (e.g. "show-onboarding")
 * - `null` when no `config` export is found or the expression can't be
 *   statically resolved
 */
export function parseStaticConfigLiteral(content: string): Record<string, unknown> | string | null {
  let ast: babelParser.ParseResult<t.File>;
  try {
    ast = babelParser.parse(content, {
      sourceType: "module",
      plugins: ["typescript", "importAttributes"],
    });
  } catch {
    return null;
  }

  for (const statement of ast.program.body) {
    if (!t.isExportNamedDeclaration(statement)) continue;
    if (!t.isVariableDeclaration(statement.declaration)) continue;
    for (const decl of statement.declaration.declarations) {
      if (!t.isIdentifier(decl.id) || decl.id.name !== "config" || decl.init == null) continue;
      const value = evaluateLiteralNode(decl.init);
      if (value === undefined) return null;
      if (typeof value === "string") return value;
      if (isRecord(value)) return value;
      return null;
    }
  }
  return null;
}

// --- inline vitest tests ---

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
  const content = renderConfigFileContent({}, "@stackframe/next");
  expect(content).toContain('import type { HexclaveConfig } from "@stackframe/next";');
});

import.meta.vitest?.test("detectConfigImportPackage picks first matching package by priority", ({ expect }) => {
  expect(detectConfigImportPackage(["@hexclave/next", "@hexclave/js"])).toBe("@hexclave/next");
  expect(detectConfigImportPackage(["@hexclave/react", "@hexclave/js"])).toBe("@hexclave/react");
  expect(detectConfigImportPackage(["@hexclave/js"])).toBe("@hexclave/js");
  expect(detectConfigImportPackage(["@hexclave/tanstack-start"])).toBe("@hexclave/tanstack-start");
  expect(detectConfigImportPackage(["@stackframe/stack", "@hexclave/next"])).toBe("@hexclave/next");
  expect(detectConfigImportPackage(["@stackframe/stack"])).toBe("@stackframe/stack");
  expect(detectConfigImportPackage(["@stackframe/template"])).toBe("@stackframe/template");
  expect(detectConfigImportPackage(["lodash", "express"])).toBeUndefined();
  expect(detectConfigImportPackage([])).toBeUndefined();
});

import.meta.vitest?.test("parseStaticConfigLiteral extracts JSON from rendered config", ({ expect }) => {
  const rendered = renderConfigFileContent({ auth: { allowSignUp: true } });
  expect(parseStaticConfigLiteral(rendered)).toEqual({ auth: { allowSignUp: true } });
});

import.meta.vitest?.test("parseStaticConfigLiteral returns null for non-static content", ({ expect }) => {
  expect(parseStaticConfigLiteral("export const config = someFunction();")).toBeNull();
  expect(parseStaticConfigLiteral("export const other = {};")).toBeNull();
  expect(parseStaticConfigLiteral("")).toBeNull();
});

import.meta.vitest?.test("parseStaticConfigLiteral returns the string for show-onboarding export", ({ expect }) => {
  expect(parseStaticConfigLiteral('export const config = "show-onboarding";')).toBe("show-onboarding");
});

import.meta.vitest?.test("parseStaticConfigLiteral handles JS object syntax (unquoted keys, trailing commas)", ({ expect }) => {
  const content = `import type { HexclaveConfig } from "@hexclave/next";
export const config: HexclaveConfig = {
  teams: { allowClientTeamCreation: false },
};`;
  expect(parseStaticConfigLiteral(content)).toEqual({ teams: { allowClientTeamCreation: false } });
});

import.meta.vitest?.test("parseStaticConfigLiteral rejects computed property keys", ({ expect }) => {
  expect(parseStaticConfigLiteral('const key = "a"; export const config = { [key]: true };')).toBeNull();
});

import.meta.vitest?.test("parseStaticConfigLiteral unwraps TS `satisfies` assertion", ({ expect }) => {
  const content = `import type { HexclaveConfig } from "@hexclave/next";
export const config = { auth: { allowSignUp: true } } satisfies HexclaveConfig;`;
  expect(parseStaticConfigLiteral(content)).toEqual({ auth: { allowSignUp: true } });
});

import.meta.vitest?.test("parseStaticConfigLiteral unwraps TS `as const` assertion", ({ expect }) => {
  expect(parseStaticConfigLiteral('export const config = { enabled: true } as const;')).toEqual({ enabled: true });
});
