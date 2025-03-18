import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListToolsResult,
  Tool
} from "@modelcontextprotocol/sdk/types.js";
import { StackServerApp, stackAppInternalsSymbol } from "@stackframe/js";
import { readFileSync } from "fs";
import type { OpenAPIV3_1 } from 'openapi-types';
import { convertParameterArrayToJsonSchema } from "./utils/openapi-to-jsonschema";




const STACK_AUTH_URL = process.env.STACK_AUTH_URL ?? "https://api.stack-auth.com/";
const STACK_SECRET_SERVER_KEY = process.env.STACK_SECRET_SERVER_KEY;
const STACK_PROJECT_ID = process.env.STACK_PROJECT_ID;
const STACK_PUBLISHABLE_CLIENT_KEY = process.env.STACK_PUBLISHABLE_CLIENT_KEY;


if (!STACK_SECRET_SERVER_KEY || !STACK_PROJECT_ID || !STACK_PUBLISHABLE_CLIENT_KEY) {
  throw new Error("STACK_SECRET_SERVER_KEY, STACK_PROJECT_ID, and STACK_PUBLISHABLE_CLIENT_KEY must be set");
}


export const stackServerApp = new StackServerApp({
  baseUrl: STACK_AUTH_URL,
  // You should store these in environment variables based on your project setup
  projectId: STACK_PROJECT_ID,
  publishableClientKey: STACK_PUBLISHABLE_CLIENT_KEY,
  secretServerKey: STACK_SECRET_SERVER_KEY,
  tokenStore: "memory",
});





// Cursor only supports 40 endpoints, so we only expose the most useful tools
const exposedEndpoints = {
  "/users/{user_id}": ["get", "patch", "delete"],
  "/users": ["get", "post"],
  "/teams": ["get", "post"],
  "/team-member-profiles": ["get"],
  "/teams/{team_id}": ["get", "patch", "delete"],
  "/team-memberships/{team_id}/{user_id}": ["post", "delete"],
  "/team-member-profiles/{team_id}/{user_id}": ["get", "patch"],
  "/team-invitations/send-code": ["post"],
  "/team-permissions/{team_id}/{user_id}/{permission_id}": ["post", "delete"],
  "/team-permissions": ["get"],
  "/contact-channels/{user_id}/{contact_channel_id}": ["get", "patch", "delete"],
  "/contact-channels": ["get"],
  // TODO fix me "/contact-channels/send-verification-code": ["post"],
}

// Define operationIDs for each endpoint and method
const operationIDs: Record<string, Record<string, string>> = {
  "/users/{user_id}": {
    "get": "getUserById",
    "patch": "updateUser",
    "delete": "deleteUser"
  },
  "/users": {
    "get": "listUsers",
    "post": "createUser"
  },
  "/teams": {
    "get": "listTeams",
    "post": "createTeam"
  },
  "/team-member-profiles": {
    "get": "listTeamMemberProfiles"
  },
  "/teams/{team_id}": {
    "get": "getTeamById",
    "patch": "updateTeam",
    "delete": "deleteTeam"
  },
  "/team-memberships/{team_id}/{user_id}": {
    "post": "addUserToTeam",
    "delete": "removeUserFromTeam"
  },
  "/team-member-profiles/{team_id}/{user_id}": {
    "get": "getTeamMemberProfile",
    "patch": "updateTeamMemberProfile"
  },
  "/team-invitations/send-code": {
    "post": "sendTeamInvitationCode"
  },
  "/team-permissions/{team_id}/{user_id}/{permission_id}": {
    "post": "grantPermissionToUser",
    "delete": "revokePermissionFromUser"
  },
  "/team-permissions": {
    "get": "listTeamPermissions"
  },
  "/contact-channels/{user_id}/{contact_channel_id}": {
    "get": "getContactChannel",
    "patch": "updateContactChannel",
    "delete": "deleteContactChannel"
  },
  "/contact-channels": {
    "get": "listContactChannels"
  }
}



function getOpenAPISchema(): OpenAPIV3_1.Document {
  return JSON.parse(readFileSync("./openapi/server.json", "utf8"));
}


function isOperationObject(obj: any): obj is OpenAPIV3_1.OperationObject {
  return obj !== null && typeof obj === 'object' && 'parameters' in obj;
}


function getOperationObject(openAPISchema: OpenAPIV3_1.Document, path: string, method: string): OpenAPIV3_1.OperationObject {
  const pathItem = openAPISchema.paths?.[path];
  if (!pathItem) {
    throw new Error(`Could not find path item ${path} in openAPI schema`);
  }
  const operation = pathItem[method as keyof typeof pathItem];
  if (!operation) {
    throw new Error(`Could not find method ${method} in path item ${path} in openAPI schema`);
  }
  if (!isOperationObject(operation)) {
    throw new Error(`Method ${method} in path ${path} is not an operation object`);
  }
  return operation;
}

function addOperationIDs(openAPISchema: OpenAPIV3_1.Document, exposedEndpoints: Record<string, string[]>) {

  // Add operationIDs to the OpenAPI schema in place
  for (const [path, methods] of Object.entries(exposedEndpoints)) {
    if (openAPISchema.paths?.[path]) {
      for (const method of methods) {
        const operation = getOperationObject(openAPISchema, path, method);
        operation.operationId = operationIDs[path][method];
      }
    }
  }
}
function filterAPIEndpoints(openAPISchema: OpenAPIV3_1.Document, exposedEndpoints: Record<string, string[]>) {
  const filteredEndpoints: Record<string, Record<string, any>> = {};
  for (const [path, methods] of Object.entries(exposedEndpoints)) {
    if (openAPISchema.paths?.[path]) {
      for (const method of methods) {
        const operation = getOperationObject(openAPISchema, path, method);
        if (!filteredEndpoints[path]) {
          filteredEndpoints[path] = {};
        }
        filteredEndpoints[path][method] = operation;
      }
    } else {
      throw new Error(`Path ${path} not found in openAPI schema`);
    }
  }
  return {
    ...openAPISchema,
    paths: filteredEndpoints
  }
}


const openAPISchema = getOpenAPISchema();
addOperationIDs(openAPISchema, exposedEndpoints);
const filteredEndpoints = filterAPIEndpoints(openAPISchema, exposedEndpoints);
const operationsMap = Object.entries(filteredEndpoints.paths).reduce((acc, [path, methods]) => {
  Object.entries(methods).forEach(([method, operation]) => {
    acc[operation.operationId] = {
      operationId: operation.operationId,
      path,
      method,
      ...operation
    };
  });
  return acc;
}, {} as Record<string, OpenAPIV3_1.OperationObject & { operationId: string, path: string, method: string }>);



const tools: Tool[] = []




for (const [name, operation] of Object.entries(operationsMap)) {

    const inputSchema = !operation.parameters ? {
      type: "object" as const,
      properties: {},
      required: [],
    } : convertParameterArrayToJsonSchema(operation.parameters, operation.requestBody)


    tools.push({
      name: operation.operationId,
      description: operation.description,
      inputSchema
    })
  }







async function main() {
  const transport = new StdioServerTransport();

  const version = (await import("../package.json", { assert: { type: "json" }})).default.version;


  // Create server instance
  const server = new Server({
    name: "stackauth",
    version,

  }, {
    capabilities: {
      tools: {}
    }
  });

  server.setRequestHandler(ListToolsRequestSchema,
    (): ListToolsResult => ({
      tools
    })
  )

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const name = request.params.name;
    const args = request.params.arguments ?? {};

    const openApi = operationsMap[name];

    if (!openApi) {
      return {
        isError: true,
        content: [{ type: "text", text: `Tool ${name} not found` }],
      }
    }

    const path = openApi.path;
    const method = openApi.method.toUpperCase();


    // Split args into path and query parameters
    const queryParams = new URLSearchParams();
    const pathParams: Record<string, string> = {};

    for (const [key, value] of Object.entries(args)) {
      if (key.endsWith("###query")) {
        const paramName = key.replace("###query", "");
        queryParams.append(paramName, String(value));
      } else if (key.endsWith("###path")) {
        const paramName = key.replace("###path", "");
        pathParams[paramName] = String(value);
      }
    }

    // Replace path parameters
    let finalPath = path;
    for (const [key, value] of Object.entries(pathParams)) {
      finalPath = finalPath.replace(`{${key}}`, value);
    }

    // Add query string if we have query parameters
    const queryString = queryParams.toString();
    if (queryString) {
      finalPath += `?${queryString}`;
    }

    let body: string | undefined;
    let headers: Record<string, string> | undefined;
    if (openApi.requestBody && args["###body###"] && typeof args["###body###"] === "string") {
      body = args["###body###"];
      headers = {
        "Content-Type": "application/json",
      }
    }

    const result = await (stackServerApp as any)[stackAppInternalsSymbol].sendRequest(finalPath, {
      method,
      headers: {
        // Hack to make api call as a server and not client, should probably create a new (internal) function for this
        "x-stack-secret-server-key": STACK_SECRET_SERVER_KEY,
        ...headers,
      },
      body,
    }, "server");

    if (!result.ok) {
      return {
        isError: true,
        content: [{ type: "text", text: `Error: ${result.status} ${await result.text()}` }],
      }
    }

    return {
      content: [{ type: "text", text: JSON.stringify(await result.json(), null, 2) }],
    }


  })

  await server.connect(transport);
}

main();
