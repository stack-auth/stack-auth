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
  const mintlifyOpenApiDir = path.resolve("../../docs-mintlify/openapi");

  // Ensure the openapi directory exists
  if (!fs.existsSync(fumaDocsOpenApiDir)) {
    console.log('Creating OpenAPI directory...');
    fs.mkdirSync(fumaDocsOpenApiDir, { recursive: true });
  }
  if (!fs.existsSync(mintlifyOpenApiDir)) {
    console.log('Creating Mintlify OpenAPI directory...');
    fs.mkdirSync(mintlifyOpenApiDir, { recursive: true });
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
    const urlPathRaw = midfix.replaceAll("[", "{").replaceAll("]", "}").replaceAll(/\/\(.*\)/g, "");
    // OpenAPI path keys must not be empty (Mintlify and other tooling reject `""`).
    const urlPath = urlPathRaw === "" ? "/" : urlPathRaw;
    const myModule = await import(importPath);
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

    const audienceJson = JSON.stringify(openApiSchemaObject, null, 2);
    // Write JSON files for Fumadocs (they prefer JSON over YAML)
    writeFileSyncIfChanged(
      path.join(fumaDocsOpenApiDir, `${audience}.json`),
      audienceJson
    );
    writeFileSyncIfChanged(
      path.join(mintlifyOpenApiDir, `${audience}.json`),
      audienceJson
    );
  }

  // Generate webhooks schema
  const webhookOpenAPISchema = parseWebhookOpenAPI({
    webhooks: webhookEvents,
  });

  const webhooksJson = JSON.stringify(webhookOpenAPISchema, null, 2);
  writeFileSyncIfChanged(
    path.join(fumaDocsOpenApiDir, 'webhooks.json'),
    webhooksJson
  );
  writeFileSyncIfChanged(
    path.join(mintlifyOpenApiDir, 'webhooks.json'),
    webhooksJson
  );

  console.log("Successfully updated Fumadocs OpenAPI schemas with proper audience filtering");
}

// eslint-disable-next-line no-restricted-syntax
main().catch((...args) => {
  console.error(`ERROR! Could not update Fumadocs OpenAPI schema`, ...args);
  process.exit(1);
});
