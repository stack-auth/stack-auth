import { NextResponse } from "next/server";
import { McpTokenVerificationError } from "@hexclave/next/mcp";
import { hexclaveServerApp } from "src/hexclave";
import { decodeJwtPayload, getDemoCallbackUrl, getDemoResourceUri, getIssuerUrl } from "../../shared";

export async function POST(request: Request) {
  const { code, codeVerifier, clientId, resource } = await request.json();
  if (typeof code !== "string" || typeof codeVerifier !== "string" || typeof clientId !== "string") {
    return NextResponse.json({ error: "code, codeVerifier, and clientId are required" }, { status: 400 });
  }

  const tokenResponse = await fetch(`${getIssuerUrl()}/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: clientId,
      redirect_uri: getDemoCallbackUrl(),
      code_verifier: codeVerifier,
      ...(typeof resource === "string" ? { resource } : {}),
    }).toString(),
  });
  const tokenBody = await tokenResponse.json();
  if (!tokenResponse.ok) {
    return NextResponse.json({ step: "token-exchange", error: tokenBody }, { status: 200 });
  }

  const accessToken: string = tokenBody.access_token;
  const claims = decodeJwtPayload(accessToken);

  const verifier = hexclaveServerApp.createMcpTokenVerifier({ resource: getDemoResourceUri() });
  let verification: { ok: boolean, reason?: string, message?: string };
  let user: { id: string, displayName: string | null, primaryEmail: string | null } | null = null;
  try {
    const authInfo = await verifier.verifyAccessToken(accessToken);
    verification = { ok: true };
    const serverUser = await hexclaveServerApp.getUser({ from: "mcp", authInfo, or: "return-null" });
    user = serverUser === null ? null : {
      id: serverUser.id,
      displayName: serverUser.displayName,
      primaryEmail: serverUser.primaryEmail,
    };
  } catch (error) {
    if (!(error instanceof McpTokenVerificationError)) throw error;
    verification = { ok: false, reason: error.reason, message: error.message };
  }

  return NextResponse.json({
    tokenResponse: {
      ...tokenBody,
      access_token: `${accessToken.slice(0, 24)}…`,
      ...(typeof tokenBody.refresh_token === "string" ? { refresh_token: `${tokenBody.refresh_token.slice(0, 12)}…` } : {}),
    },
    accessToken,
    claims,
    verification,
    user,
  });
}
