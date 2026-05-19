import * as parser from "@babel/parser";
import * as t from "@babel/types";

export const showOnboardingStackConfigValue = "show-onboarding";

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
