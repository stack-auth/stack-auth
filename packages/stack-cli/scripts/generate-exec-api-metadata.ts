#!/usr/bin/env node

import * as fs from "fs";
import * as path from "path";
import ts from "typescript";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const stackCliRoot = path.resolve(__dirname, "..");
const jsDtsPath = path.resolve(stackCliRoot, "../js/dist/index.d.ts");
const outputPath = path.resolve(stackCliRoot, "src/generated/exec-api-metadata.json");

const MAX_TYPE_LENGTH = 120;

type MethodMetadata = {
  name: string,
  signatures: string[],
};

function simplifyTypeText(text: string): string {
  const withoutImportPaths = text.replace(/import\("[^"]+"\)\./g, "");
  const compact = withoutImportPaths.replace(/\s+/g, " ").trim();
  if (compact.length <= MAX_TYPE_LENGTH) {
    return compact;
  }
  return `${compact.slice(0, MAX_TYPE_LENGTH - 3)}...`;
}

function getTypeAliasDeclaration(sourceFile: ts.SourceFile, name: string): ts.TypeAliasDeclaration {
  for (const statement of sourceFile.statements) {
    if (ts.isTypeAliasDeclaration(statement) && statement.name.text === name) {
      return statement;
    }
  }
  throw new Error(`Could not find type alias ${name} in ${sourceFile.fileName}`);
}

function formatSignature(
  checker: ts.TypeChecker,
  context: ts.Node,
  methodName: string,
  signature: ts.Signature,
): string {
  const parameterParts = signature.getParameters().map((parameterSymbol) => {
    const declaration = parameterSymbol.valueDeclaration;
    const type = checker.getTypeOfSymbolAtLocation(parameterSymbol, declaration ?? context);
    const typeText = simplifyTypeText(
      checker.typeToString(type, declaration ?? context, ts.TypeFormatFlags.NoTruncation),
    );
    const isOptional = ts.isParameter(declaration) && declaration.questionToken != null;
    const isRest = ts.isParameter(declaration) && declaration.dotDotDotToken != null;
    const rawName = parameterSymbol.getName();
    const parameterName = rawName === "__namedParameters" ? "options" : rawName;
    return `${isRest ? "..." : ""}${parameterName}${isOptional ? "?" : ""}: ${typeText}`;
  });

  const returnTypeText = simplifyTypeText(
    checker.typeToString(signature.getReturnType(), context, ts.TypeFormatFlags.NoTruncation),
  );

  return `${methodName}(${parameterParts.join(", ")}): ${returnTypeText}`;
}

function collectMethods(
  checker: ts.TypeChecker,
  sourceFile: ts.SourceFile,
  typeAliasName: string,
): MethodMetadata[] {
  const declaration = getTypeAliasDeclaration(sourceFile, typeAliasName);
  const symbol = checker.getSymbolAtLocation(declaration.name);
  if (symbol == null) {
    throw new Error(`Could not resolve symbol for ${typeAliasName}`);
  }
  const type = checker.getDeclaredTypeOfSymbol(symbol);
  const methods: MethodMetadata[] = [];

  for (const property of checker.getPropertiesOfType(type)) {
    const propertyName = property.getName();
    if (propertyName.startsWith("__@")) {
      continue;
    }

    const propertyType = checker.getTypeOfSymbolAtLocation(property, declaration.name);
    const callSignatures = propertyType.getCallSignatures();
    if (callSignatures.length === 0) {
      continue;
    }

    const signatures = Array.from(new Set(
      callSignatures.map((signature) => formatSignature(checker, declaration.name, propertyName, signature)),
    ));
    methods.push({
      name: propertyName,
      signatures,
    });
  }

  methods.sort((a, b) => a.name.localeCompare(b.name));
  return methods;
}

if (!fs.existsSync(jsDtsPath)) {
  throw new Error(`Could not find SDK declarations at ${jsDtsPath}. Build @stackframe/js first.`);
}

const program = ts.createProgram([jsDtsPath], {
  target: ts.ScriptTarget.ES2021,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  skipLibCheck: true,
  strict: true,
});

const sourceFile = program.getSourceFile(jsDtsPath);
if (sourceFile == null) {
  throw new Error(`Could not load source file ${jsDtsPath}`);
}

const checker = program.getTypeChecker();
const stackClientApp = collectMethods(checker, sourceFile, "StackClientApp");
const clientSignaturesByMethod = new Map(stackClientApp.map((method) => [method.name, new Set(method.signatures)]));
const stackServerApp = collectMethods(checker, sourceFile, "StackServerApp")
  .map((method) => {
    const clientSignatures = clientSignaturesByMethod.get(method.name);
    if (clientSignatures == null) {
      return method;
    }
    const uniqueSignatures = method.signatures.filter((signature) => !clientSignatures.has(signature));
    return {
      name: method.name,
      signatures: uniqueSignatures,
    };
  })
  .filter((method) => method.signatures.length > 0);

const output = {
  schemaVersion: 1,
  stackClientApp,
  stackServerApp,
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`);
console.log(`Wrote ${outputPath}`);
