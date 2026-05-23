import * as parser from "@babel/parser";
import * as t from "@babel/types";
import { isValidConfig, normalize } from "./config/format";

export const showOnboardingStackConfigValue = "show-onboarding";

const DEFAULT_CONFIG_IMPORT_PACKAGE = "@stackframe/js";

/**
 * Renders a config object into the source text of a `stack.config.ts` file.
 *
 * Browser-safe: kept here (next to `parseStackConfigFileContent`) instead of in
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
  const importLine = `import type { StackConfig } from "${pkg}";`;
  return `${importLine}\n\nexport const config: StackConfig = ${JSON.stringify(normalizedConfig, null, 2)};\n`;
}

type ParsedStackConfig = Record<string, unknown> | typeof showOnboardingStackConfigValue;

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

export function parseStackConfigFileContent(content: string, filePath: string): ParsedStackConfig {
  if (content.trim() === "") return {};
  const ast = parser.parse(content, {
    sourceType: "module",
    plugins: ["typescript"],
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
