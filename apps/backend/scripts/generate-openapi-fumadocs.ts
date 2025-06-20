import { parseOpenAPI, parseWebhookOpenAPI } from '@/lib/openapi';
import { isSmartRouteHandler } from '@/route-handlers/smart-route-handler';
import { webhookEvents } from '@stackframe/stack-shared/dist/interface/webhooks';
import { writeFileSyncIfChanged } from '@stackframe/stack-shared/dist/utils/fs';
import { HTTP_METHODS } from '@stackframe/stack-shared/dist/utils/http';
import { typedKeys } from '@stackframe/stack-shared/dist/utils/objects';
import fs from 'fs';
import { glob } from 'glob';
import path from 'path';


async function main() {
  console.log("Started Fumadocs OpenAPI schema generator");

  // Create openapi directory in Fumadocs project
  const fumaDocsOpenApiDir = path.resolve("../../docs/openapi");

  // Ensure the openapi directory exists
  if (!fs.existsSync(fumaDocsOpenApiDir)) {
    console.log('Creating OpenAPI directory...');
    fs.mkdirSync(fumaDocsOpenApiDir, { recursive: true });
  }

  // Generate OpenAPI specs for each audience (let parseOpenAPI handle the filtering)
  const filePathPrefix = path.resolve(process.platform === "win32" ? "apps/src/app/api/latest" : "src/app/api/latest");
  const importPathPrefix = "@/app/api/latest";
  const filePaths = [...await glob(filePathPrefix + "/**/route.{js,jsx,ts,tsx}")];

  const endpoints = new Map(await Promise.all(filePaths.map(async (filePath) => {
    if (!filePath.startsWith(filePathPrefix)) {
      throw new Error(`Invalid file path: ${filePath}`);
    }
    const suffix = filePath.slice(filePathPrefix.length);
    const midfix = suffix.slice(0, suffix.lastIndexOf("/route."));
    const importPath = `${importPathPrefix}${suffix}`;
    const urlPath = midfix.replaceAll("[", "{").replaceAll("]", "}").replaceAll(/\/\(.*\)/g, "");
    const myModule = require(importPath);
    const handlersByMethod = new Map(
      typedKeys(HTTP_METHODS).map(method => [method, myModule[method]] as const)
        .filter(([_, handler]) => isSmartRouteHandler(handler))
    );
    return [urlPath, handlersByMethod] as const;
  })));

  console.log(`Found ${endpoints.size} total endpoint files`);

  // Generate specs for each audience using parseOpenAPI's built-in filtering
  for (const audience of ['client', 'server', 'admin'] as const) {
    const openApiSchemaObject = parseOpenAPI({
      endpoints,
      audience, // Let parseOpenAPI handle the audience-specific filtering
    });

    // Update server URL for Fumadocs
    openApiSchemaObject.servers = [{
      url: 'https://api.stack-auth.com/api/v1',
      description: 'Stack REST API',
    }];

    console.log(`Generated ${Object.keys(openApiSchemaObject.paths || {}).length} endpoints for ${audience} audience`);

    // Write JSON files for Fumadocs (they prefer JSON over YAML)
    writeFileSyncIfChanged(
      path.join(fumaDocsOpenApiDir, `${audience}.json`),
      JSON.stringify(openApiSchemaObject, null, 2)
    );
  }

  // Generate webhooks schema
  const webhookOpenAPISchema = parseWebhookOpenAPI({
    webhooks: webhookEvents,
  });

  writeFileSyncIfChanged(
    path.join(fumaDocsOpenApiDir, 'webhooks.json'),
    JSON.stringify(webhookOpenAPISchema, null, 2)
  );

  console.log("Successfully updated Fumadocs OpenAPI schemas with proper audience filtering");
}

main().catch((...args) => {
  console.error(`ERROR! Could not update Fumadocs OpenAPI schema`, ...args);
  process.exit(1);
});
