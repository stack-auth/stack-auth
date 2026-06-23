import { existsSync, readFileSync } from "fs";
import { createJiti } from "jiti";
import path from "path";

export { hexclaveConfigFileExportsConfig } from "./hexclave-config-file";

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
        for (const known of CONFIG_IMPORT_PACKAGES) {
          if (deps.includes(known)) {
            return known;
          }
        }
        return undefined;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

type ParsedConfigValue = Record<string, unknown> | string;

/**
 * Evaluates config file content using jiti and returns the exported `config`
 * value. Replaces the old Babel AST-based `parseHexclaveConfigFileContent`.
 *
 * WARNING: This executes arbitrary code via `jiti.evalModule` — only use on
 * content that is fully operator-controlled (local filesystem). Never call
 * this on untrusted input (e.g. content fetched from a remote repository).
 */
export function evalConfigFileContent(content: string, filePath: string): ParsedConfigValue {
  if (content.trim() === "") return {};
  const resolvedPath = path.isAbsolute(filePath) ? filePath : path.resolve(filePath);
  const mod: unknown = jiti.evalModule(content, { filename: resolvedPath });
  if (!isRecord(mod)) {
    throw new Error(`Invalid config in ${filePath}. The file must export a plain \`config\` object or "show-onboarding".`);
  }
  const config = mod.config;
  if (config === undefined) {
    throw new Error(`Invalid config in ${filePath}. The file must export a plain \`config\` object or "show-onboarding".`);
  }
  if (typeof config === "string") return config;
  if (isRecord(config)) return config;
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

// --- inline vitest tests ---

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

import.meta.vitest?.test("tryEvalConfigFileContent returns null on unresolvable function call", ({ expect }) => {
  expect(tryEvalConfigFileContent("export const config = someUndefinedFunction();", "stack.config.ts")).toBeNull();
});

import.meta.vitest?.test("tryEvalConfigFileContent returns null on unresolvable import", ({ expect }) => {
  expect(tryEvalConfigFileContent('import x from "./nonexistent-file";\nexport const config = { a: x };', "stack.config.ts")).toBeNull();
});

import.meta.vitest?.test("tryEvalConfigFileContent returns null on syntax error", ({ expect }) => {
  expect(tryEvalConfigFileContent("export const config = {", "stack.config.ts")).toBeNull();
});
