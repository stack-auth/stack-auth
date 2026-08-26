import { McpTokenVerificationError } from "@hexclave/next/mcp";
import { NextResponse } from "next/server";
import { hexclaveServerApp } from "src/hexclave";
import { getDemoResourceUri, getIssuerUrl } from "../../shared";

const verifier = hexclaveServerApp.createMcpTokenVerifier({ resource: getDemoResourceUri() });

function unauthorized(description: string) {
  return NextResponse.json(
    { error: "invalid_token", error_description: description },
    {
      status: 401,
      headers: { "www-authenticate": `Bearer resource_metadata="${getDemoResourceUri()}", authorization_server="${getIssuerUrl()}"` },
    },
  );
}

export async function GET(request: Request) {
  let authInfo;
  try {
    authInfo = await verifier(request);
  } catch (error) {
    if (error instanceof McpTokenVerificationError) {
      return unauthorized(`${error.reason}: ${error.message}`);
    }
    throw error;
  }
  if (authInfo === undefined) {
    return unauthorized("No bearer token was provided.");
  }

  const user = await hexclaveServerApp.getUser({ from: "mcp", authInfo, or: "return-null" });
  return NextResponse.json({
    message: "Token accepted by the resource server.",
    authInfo: {
      clientId: authInfo.clientId,
      scopes: authInfo.scopes,
      resource: authInfo.resource?.toString(),
      expiresAt: authInfo.expiresAt,
      extra: authInfo.extra,
    },
    user: user === null ? null : {
      id: user.id,
      displayName: user.displayName,
      primaryEmail: user.primaryEmail,
    },
  });
}
