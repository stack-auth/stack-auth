import { SmartRouter } from "@/smart-router";
import fs from "fs";

const httpMethodNames = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"] as const;

function stringCompare(a: string, b: string) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function routeFilePathToImportPath(filePath: string) {
  return `@/${filePath.replace(/^src\//, "").replace(/\.(ts|tsx|js|jsx)$/, "")}`;
}

function generateRouteModules(routes: Awaited<ReturnType<typeof SmartRouter.listRoutes>>) {
  const routeFiles = routes
    .filter(route => route.isRoute && /\/route\.(ts|tsx|js|jsx)$/.test(route.filePath))
    .sort((a, b) => stringCompare(a.normalizedPath, b.normalizedPath) || stringCompare(a.filePath, b.filePath));

  const imports = routeFiles.map((route, index) => {
    return `import * as r${index} from ${JSON.stringify(routeFilePathToImportPath(route.filePath))};`;
  });

  const entries = routeFiles.map((route, index) => {
    return `  { normalizedPath: ${JSON.stringify(route.normalizedPath)}, module: r${index} },`;
  });

  return `import type { UnknownRouteModule } from "@/server/registry";

${imports.join("\n")}

export const httpMethodNames = ${JSON.stringify(httpMethodNames)} as const;

export const routeModules: readonly { normalizedPath: string, module: UnknownRouteModule }[] = [
${entries.join("\n")}
];
`;
}

async function main() {
  const routes = await SmartRouter.listRoutes();
  const apiVersions = await SmartRouter.listApiVersions();
  fs.mkdirSync("src/generated", { recursive: true });
  fs.writeFileSync("src/generated/routes.json", JSON.stringify(routes, null, 2));
  fs.writeFileSync("src/generated/api-versions.json", JSON.stringify(apiVersions, null, 2));
  fs.writeFileSync("src/generated/route-modules.ts", generateRouteModules(routes));
  console.log("Successfully updated route info");
}
// eslint-disable-next-line no-restricted-syntax
main().catch((...args) => {
  console.error(`ERROR! Could not update route info`, ...args);
  process.exit(1);
});
