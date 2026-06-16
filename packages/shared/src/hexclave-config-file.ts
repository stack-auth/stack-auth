import * as parser from "@babel/parser";
import * as t from "@babel/types";
import { isValidConfig, normalize } from "./config/format";

export const showOnboardingHexclaveConfigValue = "show-onboarding";

const DEFAULT_CONFIG_IMPORT_PACKAGE = "@hexclave/js";

/**
 * Renders a config object into the source text of a `stack.config.ts` file.
 *
 * Browser-safe: kept here (next to `parseHexclaveConfigFileContent`) instead of in
 * `config-rendering.ts` so dashboard client code can render config files
 * without pulling in `fs` / `path`.
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

type ParsedStackConfig = Record<string, unknown> | typeof showOnboardingHexclaveConfigValue;

function unwrapStaticConfigExpression(expression: t.Expression): t.Expression {
  if (
    t.isTSAsExpression(expression)
    || t.isTSSatisfiesExpression(expression)
    || t.isTSTypeAssertion(expression)
    || t.isTSNonNullExpression(expression)
  ) {
    return unwrapStaticConfigExpression(expression.expression);
  }
  return expression;
}

function evaluateStaticConfigExpression(expression: t.Expression): unknown {
  const unwrapped = unwrapStaticConfigExpression(expression);
  if (t.isStringLiteral(unwrapped)) return unwrapped.value;
  if (t.isBooleanLiteral(unwrapped)) return unwrapped.value;
  if (t.isNumericLiteral(unwrapped)) return unwrapped.value;
  if (t.isNullLiteral(unwrapped)) return null;
  if (t.isIdentifier(unwrapped) && unwrapped.name === "undefined") return undefined;
  if (t.isUnaryExpression(unwrapped) && unwrapped.operator === "-" && t.isNumericLiteral(unwrapped.argument)) {
    return -unwrapped.argument.value;
  }
  if (t.isArrayExpression(unwrapped)) {
    return unwrapped.elements.map((element) => {
      if (element == null || t.isSpreadElement(element)) {
        throw new Error("Config arrays cannot contain holes or spreads.");
      }
      return evaluateStaticConfigExpression(element);
    });
  }
  if (t.isObjectExpression(unwrapped)) {
    const result: Record<string, unknown> = {};
    for (const property of unwrapped.properties) {
      if (t.isSpreadElement(property)) {
        throw new Error("Config objects cannot contain spreads.");
      }
      if (property.computed) {
        throw new Error("Config object keys cannot be computed.");
      }
      const key = t.isIdentifier(property.key)
        ? property.key.name
        : t.isStringLiteral(property.key) || t.isNumericLiteral(property.key)
          ? String(property.key.value)
          : null;
      if (key == null) {
        throw new Error("Unsupported config object key.");
      }
      if (t.isObjectMethod(property)) {
        throw new Error("Config objects cannot contain methods.");
      }
      if (!t.isExpression(property.value)) {
        throw new Error("Unsupported config object value.");
      }
      result[key] = evaluateStaticConfigExpression(property.value);
    }
    return result;
  }
  throw new Error(`Unsupported config expression: ${unwrapped.type}`);
}

/**
 * Like {@link parseHexclaveConfigFileContent}, but returns `null` instead of
 * throwing when the file is not a plain static config (e.g. it wraps the config
 * in a helper call, references imported values, or has a syntax error). Useful
 * for deciding whether a config file can be safely regenerated deterministically
 * or whether it has custom structure that must be preserved.
 */
export function tryParseHexclaveConfigFileContent(content: string, filePath: string): ParsedStackConfig | null {
  try {
    return parseHexclaveConfigFileContent(content, filePath);
  } catch {
    return null;
  }
}

/**
 * Returns whether `content` parses as a module that exports a `config` binding.
 * Used as a lightweight structural sanity check after editing config files whose
 * values can't be evaluated by our loader (e.g. they import external text
 * files), where a full semantic comparison isn't possible.
 */
export function hexclaveConfigFileExportsConfig(content: string, filePath: string): boolean {
  let ast: parser.ParseResult<t.File>;
  try {
    ast = parser.parse(content, {
      sourceType: "module",
      sourceFilename: filePath,
      plugins: ["typescript", "importAttributes"],
    });
  } catch {
    return false;
  }
  for (const statement of ast.program.body) {
    if (!t.isExportNamedDeclaration(statement)) {
      continue;
    }
    // Ignore type-only exports (`export type { config }`): they don't produce a
    // runtime `config` value, so they must not satisfy the structural check.
    if (statement.exportKind === "type") {
      continue;
    }
    if (t.isVariableDeclaration(statement.declaration)) {
      for (const declaration of statement.declaration.declarations) {
        if (t.isIdentifier(declaration.id) && declaration.id.name === "config" && declaration.init != null) {
          return true;
        }
      }
    }
    for (const specifier of statement.specifiers) {
      if (t.isExportSpecifier(specifier) && specifier.exportKind !== "type") {
        const exportedName = t.isIdentifier(specifier.exported) ? specifier.exported.name : specifier.exported.value;
        if (exportedName === "config") {
          return true;
        }
      }
    }
  }
  return false;
}

/**
 * Returns the relative import sources (those starting with `./` or `../`)
 * declared in `content`. Used to discover the external files a config update may
 * touch — e.g. `import x from "./welcome-email.tsx" with { type: "text" }` — so
 * they can be snapshotted and rolled back if an in-place update fails. Returns
 * an empty array if the file can't be parsed.
 */
export function getRelativeImportSpecifiers(content: string): string[] {
  let ast: parser.ParseResult<t.File>;
  try {
    ast = parser.parse(content, {
      sourceType: "module",
      plugins: ["typescript", "importAttributes"],
    });
  } catch {
    return [];
  }
  const sources: string[] = [];
  for (const statement of ast.program.body) {
    if (t.isImportDeclaration(statement)) {
      const source = statement.source.value;
      if (source.startsWith("./") || source.startsWith("../")) {
        sources.push(source);
      }
    }
  }
  return sources;
}

export function parseHexclaveConfigFileContent(content: string, filePath: string): ParsedStackConfig {
  if (content.trim() === "") return {};
  const ast = parser.parse(content, {
    sourceType: "module",
    plugins: ["typescript", "importAttributes"],
  });

  for (const statement of ast.program.body) {
    if (!t.isExportNamedDeclaration(statement) || !t.isVariableDeclaration(statement.declaration)) {
      continue;
    }
    for (const declaration of statement.declaration.declarations) {
      if (!t.isIdentifier(declaration.id) || declaration.id.name !== "config") {
        continue;
      }
      if (declaration.init == null || !t.isExpression(declaration.init)) {
        throw new Error(`Config export in ${filePath} must have an initializer.`);
      }
      return evaluateStaticConfigExpression(declaration.init) as ParsedStackConfig;
    }
  }

  throw new Error(`Invalid config in ${filePath}. The file must export a plain \`config\` object or "show-onboarding".`);
}
