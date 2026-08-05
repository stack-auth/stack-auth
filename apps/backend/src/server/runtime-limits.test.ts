import { routeModules } from "@/generated/route-modules";
import { DEFAULT_ROUTE_MAX_DURATION_SECONDS, VERCEL_FUNCTION_MAX_DURATION_SECONDS } from "./runtime-limits";
import fs from "node:fs";
import ts from "typescript";
import { test } from "vitest";

test("the shared Elysia function supports the longest backend routes", ({ expect }) => {
  const entrypoint = ts.createSourceFile(
    "src/index.ts",
    fs.readFileSync(new URL("../index.ts", import.meta.url), "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  const configDeclaration = entrypoint.statements
    .filter(ts.isVariableStatement)
    .flatMap((statement) => [...statement.declarationList.declarations])
    .find((declaration) => ts.isIdentifier(declaration.name) && declaration.name.text === "config");
  if (configDeclaration?.initializer == null || !ts.isObjectLiteralExpression(configDeclaration.initializer)) {
    throw new Error("The Vercel entrypoint must export a literal config object");
  }
  const maxDurationProperty = configDeclaration.initializer.properties.find((property) =>
    ts.isPropertyAssignment(property)
    && ts.isIdentifier(property.name)
    && property.name.text === "maxDuration"
  );
  if (maxDurationProperty == null
    || !ts.isPropertyAssignment(maxDurationProperty)
    || !ts.isNumericLiteral(maxDurationProperty.initializer)) {
    throw new Error("The Vercel entrypoint config must define maxDuration as a numeric literal");
  }

  expect(Number(maxDurationProperty.initializer.text)).toBe(VERCEL_FUNCTION_MAX_DURATION_SECONDS);
});

test("logical routes retain their individual duration budgets", ({ expect }) => {
  const durationsByPath = new Map(routeModules.map((route) => [
    route.normalizedPath,
    route.maxDurationSeconds ?? DEFAULT_ROUTE_MAX_DURATION_SECONDS,
  ]));

  expect({
    defaultRoute: durationsByPath.get("/api/latest/users"),
    deployment: durationsByPath.get("/api/latest/deployments/services/[service_id]/deploy"),
    configApply: durationsByPath.get("/api/latest/internal/config/github/apply"),
    configCancel: durationsByPath.get("/api/latest/internal/config/github/cancel"),
    configCommit: durationsByPath.get("/api/latest/internal/config/github/commit"),
    workflow: durationsByPath.get("/api/latest/internal/workflow-engine-step"),
  }).toEqual({
    defaultRoute: 300,
    deployment: 300,
    configApply: 800,
    configCancel: 60,
    configCommit: 120,
    workflow: 800,
  });
});
