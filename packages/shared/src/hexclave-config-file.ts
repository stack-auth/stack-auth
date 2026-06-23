import * as parser from "@babel/parser";
import * as t from "@babel/types";

export const showOnboardingHexclaveConfigValue = "show-onboarding";

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


