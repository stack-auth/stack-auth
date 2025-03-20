import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListToolsResult
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
  projectId: STACK_PROJECT_ID,
  publishableClientKey: STACK_PUBLISHABLE_CLIENT_KEY,
  secretServerKey: STACK_SECRET_SERVER_KEY,
  tokenStore: "memory",
});

// Cursor only supports 40 endpoints, so we only expose the most useful tools
const operationIDs = {
  "getUserById": ["/users/{user_id}", "get"],
  "updateUser": ["/users/{user_id}", "patch"],
  "deleteUser": ["/users/{user_id}", "delete"],
  "listUsers": ["/users", "get"],
  "createUser": ["/users", "post"],
  "listTeams": ["/teams", "get"],
  "createTeam": ["/teams", "post"],
  "listTeamMemberProfiles": ["/team-member-profiles", "get"],
  "getTeamById": ["/teams/{team_id}", "get"],
  "updateTeam": ["/teams/{team_id}", "patch"],
  "deleteTeam": ["/teams/{team_id}", "delete"],
  "addUserToTeam": ["/team-memberships/{team_id}/{user_id}", "post"],
  "removeUserFromTeam": ["/team-memberships/{team_id}/{user_id}", "delete"],
  "getTeamMemberProfile": ["/team-member-profiles/{team_id}/{user_id}", "get"],
  "updateTeamMemberProfile": ["/team-member-profiles/{team_id}/{user_id}", "patch"],
  "sendTeamInvitationCode": ["/team-invitations/send-code", "post"],
  "grantPermissionToUser": ["/team-permissions/{team_id}/{user_id}/{permission_id}", "post"],
  "revokePermissionFromUser": ["/team-permissions/{team_id}/{user_id}/{permission_id}", "delete"],
  "listTeamPermissions": ["/team-permissions", "get"],
  "getContactChannel": ["/contact-channels/{user_id}/{contact_channel_id}", "get"],
  "updateContactChannel": ["/contact-channels/{user_id}/{contact_channel_id}", "patch"],
  "deleteContactChannel": ["/contact-channels/{user_id}/{contact_channel_id}", "delete"],
  "listContactChannels": ["/contact-channels", "get"]
};

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

type ToolType = {
  path: string,
  method: string,
  name: string,
  description: string | undefined,
  inputSchema: {
    [x: string]: unknown,
    type: "object",
    properties?: {
      [x: string]: unknown,
    } | undefined,
  },
}


function getToolsFromOpenAPI(openAPISchema: OpenAPIV3_1.Document): ToolType[] {
  const tools: ToolType[] = Object.entries(operationIDs).map(([operationID, [path, method]]) => {
    const operation = getOperationObject(openAPISchema, path, method);
    const inputSchema = !operation.parameters ? {
      type: "object" as const,
      properties: {},
      required: [],
    } : convertParameterArrayToJsonSchema(operation.parameters, operation.requestBody);


    return {
      name: operationID,
      description: operation.description,
      inputSchema,
      path,
      method,
    };
  });

  return tools;
}


async function main() {

  const openAPISchema = getOpenAPISchema();
  const tools = getToolsFromOpenAPI(openAPISchema);
  const transport = new StdioServerTransport();
  const version = (await import("../package.json", { assert: { type: "json" } })).default.version;

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
  );

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const name = request.params.name;
    const args = request.params.arguments ?? {};

    const tool = tools.find(tool => tool.name === name);

    if (!tool) {
      return {
        isError: true,
        content: [{ type: "text", text: `Tool ${name} not found` }],
      };
    }

    const path = tool.path;
    const method = tool.method.toUpperCase();


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
    // LIMITATION: we only support JSON body for now
    if (args["###body###"] && typeof args["###body###"] === "string") {
      body = args["###body###"];
      headers = {
        "Content-Type": "application/json",
      };
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
      };
    }

    return {
      content: [{ type: "text", text: JSON.stringify(await result.json(), null, 2) }],
    };


  });

  await server.connect(transport);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
