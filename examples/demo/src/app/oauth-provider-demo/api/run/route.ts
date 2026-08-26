import { createMcpTokenVerifier, McpTokenVerificationError } from "@hexclave/next/mcp";
import { NextResponse } from "next/server";
import { throwErr } from "@hexclave/shared/dist/utils/errors";
import { createHash, randomBytes } from "node:crypto";
import { hexclaveServerApp } from "src/hexclave";
import {
  DEMO_CLIENT_ID,
  DEMO_TEST_CASES,
  DEMO_TRUSTED_CLIENT_ID,
  DemoTestCaseId,
  getApiBaseUrl,
  getDemoCallbackUrl,
  getDemoResourceUri,
  getIssuerUrl,
  getProjectId,
  OAUTH_SCOPE,
} from "../../shared";

class TestFailure extends Error {}

function expect(condition: boolean, message: string): asserts condition {
  if (!condition) throw new TestFailure(message);
}

type Step = { label: string, detail?: string };

type Ctx = {
  log: (label: string, detail?: string) => void,
  clientHeaders: Record<string, string>,
  issuer: string,
};

function updateCookies(cookieString: string, response: Response): string {
  const jar = new Map(
    cookieString.split("; ").filter(pair => pair !== "").map(pair => [pair.split("=")[0], pair]),
  );
  for (const setCookie of response.headers.getSetCookie()) {
    const pair = setCookie.split(";")[0];
    jar.set(pair.split("=")[0], pair);
  }
  return [...jar.values()].join("; ");
}

function pkcePair() {
  const codeVerifier = randomBytes(32).toString("base64url");
  const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");
  return { codeVerifier, codeChallenge };
}

function authorizeUrl(ctx: Ctx, params: Record<string, string>): string {
  return `${ctx.issuer}/auth?${new URLSearchParams(params).toString()}`;
}

async function startInteraction(ctx: Ctx, options: { clientId: string, codeChallenge: string }) {
  const authorize = await fetch(authorizeUrl(ctx, {
    response_type: "code",
    client_id: options.clientId,
    redirect_uri: getDemoCallbackUrl(),
    scope: OAUTH_SCOPE,
    resource: getDemoResourceUri(),
    code_challenge: options.codeChallenge,
    code_challenge_method: "S256",
    // offline_access is spec-gated behind an explicit consent prompt; without this the provider
    // silently drops the scope and no refresh token is issued.
    prompt: "consent",
  }), { redirect: "manual" });
  expect(authorize.status === 303, `authorize should answer 303, got ${authorize.status}`);
  let cookie = updateCookies("", authorize);
  const interactionLocation = authorize.headers.get("location") ?? throwErr("authorize 303 had no location header");
  ctx.log("Authorize accepted", `→ ${new URL(interactionLocation).pathname}`);

  const interaction = await fetch(interactionLocation, { redirect: "manual", headers: { cookie } });
  expect(interaction.status === 307, `interaction should redirect (307) to the hosted consent page, got ${interaction.status}`);
  cookie = updateCookies(cookie, interaction);
  const hostedLocation = interaction.headers.get("location") ?? "";
  expect(hostedLocation.includes("/handler/oauth-provider-interaction"), `interaction should point at the hosted consent page, got ${hostedLocation}`);
  ctx.log("Interaction created", "provider session cookie stored; consent would render on the hosted page");

  return {
    interactionUid: new URL(interactionLocation).pathname.split("/").at(-1) ?? throwErr("could not extract interaction uid"),
    cookie,
  };
}

async function decideInteraction(ctx: Ctx, interactionUid: string, denied: boolean): Promise<string> {
  const decision = await fetch(
    `${getApiBaseUrl()}/api/v1/projects/${encodeURIComponent(getProjectId())}/oauth-provider/interaction/${encodeURIComponent(interactionUid)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json", ...ctx.clientHeaders },
      body: JSON.stringify({ denied }),
    },
  );
  const body = await decision.json();
  expect(decision.status === 200, `recording the consent decision should answer 200, got ${decision.status}: ${JSON.stringify(body)}`);
  ctx.log(denied ? "Consent denied" : "Consent approved", "as the signed-in demo user, via the interaction REST endpoint");
  return body.done_url ?? throwErr("decision response had no done_url");
}

async function completeInteraction(ctx: Ctx, doneUrl: string, cookie: string): Promise<URL> {
  const completed = await fetch(doneUrl, { redirect: "manual", headers: { cookie } });
  expect(completed.status === 303, `done endpoint should answer 303, got ${completed.status}`);
  const resumed = await fetch(completed.headers.get("location") ?? "", {
    redirect: "manual",
    headers: { cookie: updateCookies(cookie, completed) },
  });
  expect(resumed.status === 303, `resume should answer 303, got ${resumed.status}`);
  const callback = new URL(resumed.headers.get("location") ?? throwErr("resume 303 had no location header"));
  ctx.log("Interaction completed", `redirected back to ${callback.origin}${callback.pathname}`);
  return callback;
}

async function approveAndGetCode(ctx: Ctx, clientId: string) {
  const { codeVerifier, codeChallenge } = pkcePair();
  const { interactionUid, cookie } = await startInteraction(ctx, { clientId, codeChallenge });
  const doneUrl = await decideInteraction(ctx, interactionUid, false);
  const callback = await completeInteraction(ctx, doneUrl, cookie);
  const code = callback.searchParams.get("code") ?? throwErr(`callback carried no code: ${callback.toString()}`);
  return { code, codeVerifier };
}

async function exchangeCode(ctx: Ctx, options: { code: string, codeVerifier: string, clientId: string, resource?: string }) {
  const response = await fetch(`${ctx.issuer}/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: options.code,
      client_id: options.clientId,
      redirect_uri: getDemoCallbackUrl(),
      code_verifier: options.codeVerifier,
      ...(options.resource === undefined ? {} : { resource: options.resource }),
    }).toString(),
  });
  return { status: response.status, body: await response.json() };
}

const TESTS: Record<DemoTestCaseId, (ctx: Ctx) => Promise<void>> = {
  "discovery": async (ctx) => {
    const openid = await fetch(`${ctx.issuer}/.well-known/openid-configuration`);
      expect(openid.status === 200, `openid-configuration should answer 200, got ${openid.status}`);
      expect(openid.headers.get("access-control-allow-origin") === "*", "discovery must be CORS-readable (access-control-allow-origin: *)");
      const openidBody = await openid.json();
      expect(openidBody.issuer === ctx.issuer, `issuer should be ${ctx.issuer}, got ${openidBody.issuer}`);
      ctx.log("openid-configuration OK", `issuer, CORS *, token_endpoint=${openidBody.token_endpoint}`);

      const rfc8414 = await fetch(`${ctx.issuer}/.well-known/oauth-authorization-server`);
      expect(rfc8414.status === 200, `oauth-authorization-server should answer 200, got ${rfc8414.status}`);
      expect(JSON.stringify(await rfc8414.json()) === JSON.stringify(openidBody), "both metadata documents must be identical");
      ctx.log("oauth-authorization-server OK", "identical to openid-configuration");

      const jwks = await fetch(openidBody.jwks_uri);
      expect(jwks.status === 200, `JWKS should answer 200, got ${jwks.status}`);
      const keys = (await jwks.json()).keys;
      expect(Array.isArray(keys) && keys.length > 0, "JWKS must publish at least one signing key");
      ctx.log("JWKS OK", `${keys.length} key(s) at ${openidBody.jwks_uri}`);
  },

  "happy-path": async (ctx) => {
    const { code, codeVerifier } = await approveAndGetCode(ctx, DEMO_CLIENT_ID);
    const token = await exchangeCode(ctx, { code, codeVerifier, clientId: DEMO_CLIENT_ID, resource: getDemoResourceUri() });
      expect(token.status === 200, `token exchange should answer 200, got ${token.status}: ${JSON.stringify(token.body)}`);
      expect(typeof token.body.access_token === "string", "token response must carry an access_token");
      expect(typeof token.body.refresh_token === "string", "offline_access was requested, so a refresh_token must be issued");
      ctx.log("Token issued", `token_type=${token.body.token_type}`);

      const verifier = hexclaveServerApp.createMcpTokenVerifier({ resource: getDemoResourceUri() });
      const authInfo = await verifier.verifyAccessToken(token.body.access_token);
      expect(authInfo.resource?.toString() === getDemoResourceUri(), "verified resource must equal the configured resource URI");
      ctx.log("SDK verifier accepted the token", `clientId=${authInfo.clientId}, resource=${authInfo.resource}`);

      const user = await hexclaveServerApp.getUser({ from: "mcp", authInfo, or: "return-null" });
      expect(user !== null, "getUser({ from: 'mcp' }) must resolve the consenting user");
      ctx.log("Resolved Hexclave user from the token", `${user.id} (${user.primaryEmail ?? "no email"})`);

      const asSessionToken = await fetch(`${getApiBaseUrl()}/api/v1/users/me`, {
        headers: { ...ctx.clientHeaders, "x-stack-access-token": token.body.access_token },
      });
      expect(asSessionToken.status === 401, `the provider access token must be rejected as a session token (expected 401, got ${asSessionToken.status})`);
      ctx.log("Provider token rejected by the main Hexclave API", "401 — not replayable as a session token");

      const refreshed = await fetch(`${ctx.issuer}/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: token.body.refresh_token,
          client_id: DEMO_CLIENT_ID,
          resource: getDemoResourceUri(),
        }).toString(),
      });
      expect(refreshed.status === 200, `refresh should answer 200, got ${refreshed.status}`);
      const refreshedBody = await refreshed.json();
      expect(typeof refreshedBody.access_token === "string", "refresh must mint a new access token");
      ctx.log("Refresh grant OK");

      const revoked = await fetch(`${ctx.issuer}/token/revocation`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token: refreshedBody.refresh_token ?? token.body.refresh_token, client_id: DEMO_CLIENT_ID }).toString(),
      });
      expect(revoked.status === 200, `revocation should answer 200, got ${revoked.status}`);
      const refreshAfterRevoke = await fetch(`${ctx.issuer}/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: refreshedBody.refresh_token ?? token.body.refresh_token,
          client_id: DEMO_CLIENT_ID,
          resource: getDemoResourceUri(),
        }).toString(),
      });
      expect(refreshAfterRevoke.status === 400, `refresh after revocation must fail (expected 400, got ${refreshAfterRevoke.status})`);
      ctx.log("Revocation OK", "refresh token no longer usable");
  },

  "interaction-details": async (ctx) => {
    const { codeChallenge } = pkcePair();
    const { interactionUid } = await startInteraction(ctx, { clientId: DEMO_CLIENT_ID, codeChallenge });
    const details = await fetch(
        `${getApiBaseUrl()}/api/v1/projects/${encodeURIComponent(getProjectId())}/oauth-provider/interaction/${encodeURIComponent(interactionUid)}`,
        { headers: ctx.clientHeaders },
      );
      expect(details.status === 200, `interaction details should answer 200, got ${details.status}`);
      const body = await details.json();
      expect(body.client?.id === DEMO_CLIENT_ID, `client id should be ${DEMO_CLIENT_ID}, got ${body.client?.id}`);
      expect(body.resource?.uri === getDemoResourceUri(), `resource uri should be ${getDemoResourceUri()}, got ${body.resource?.uri}`);
      expect(body.trusted_client === false, "demoClient must not be reported as trusted");
      ctx.log("Details OK", `client=${body.client.display_name}, resource=${body.resource.display_name}, trusted=${body.trusted_client}`);
  },

  "trusted-client": async (ctx) => {
    const { codeChallenge } = pkcePair();
    const { interactionUid } = await startInteraction(ctx, { clientId: DEMO_TRUSTED_CLIENT_ID, codeChallenge });
    const details = await fetch(
        `${getApiBaseUrl()}/api/v1/projects/${encodeURIComponent(getProjectId())}/oauth-provider/interaction/${encodeURIComponent(interactionUid)}`,
        { headers: ctx.clientHeaders },
      );
      expect(details.status === 200, `interaction details should answer 200, got ${details.status}`);
      const body = await details.json();
      expect(body.trusted_client === true, "demoTrustedClient must be reported as trusted");
      ctx.log("Trusted flag OK", "the hosted consent page auto-approves for this client");
  },

  "deny-and-replay": async (ctx) => {
    const { codeChallenge } = pkcePair();
    const { interactionUid, cookie } = await startInteraction(ctx, { clientId: DEMO_CLIENT_ID, codeChallenge });
    const doneUrl = await decideInteraction(ctx, interactionUid, true);
    const callback = await completeInteraction(ctx, doneUrl, cookie);
      expect(callback.searchParams.get("error") === "access_denied", `callback should carry error=access_denied, got ${callback.search}`);
      ctx.log("Deny OK", "client received error=access_denied");

      const replay = await fetch(doneUrl, { redirect: "manual", headers: { cookie } });
      expect(replay.status === 400, `replaying the done URL must fail (expected 400, got ${replay.status})`);
      ctx.log("Replay rejected", "the recorded decision was consumed");
  },

  "pkce-required": async (ctx) => {
    const response = await fetch(authorizeUrl(ctx, {
      response_type: "code",
      client_id: DEMO_CLIENT_ID,
      redirect_uri: getDemoCallbackUrl(),
      scope: OAUTH_SCOPE,
      resource: getDemoResourceUri(),
    }), { redirect: "manual" });
      expect(response.status === 303, `authorize should still redirect (303), got ${response.status}`);
      const location = new URL(response.headers.get("location") ?? "");
      expect(location.searchParams.get("error") === "invalid_request", `redirect should carry error=invalid_request, got ${location.search}`);
      ctx.log("PKCE enforcement OK", "missing code_challenge → error=invalid_request on the redirect");
  },

  "unknown-client": async (ctx) => {
    const { codeChallenge } = pkcePair();
    const response = await fetch(authorizeUrl(ctx, {
      response_type: "code",
      client_id: "not-a-real-client",
      redirect_uri: getDemoCallbackUrl(),
      scope: OAUTH_SCOPE,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
    }), { redirect: "manual", headers: { accept: "application/json" } });
      expect(response.status === 400, `unknown client should answer 400, got ${response.status}`);
      const body = await response.json();
      expect(body.error === "invalid_client", `error should be invalid_client, got ${body.error}`);
      ctx.log("Unknown client rejected", "400 invalid_client");
  },

  "undeclared-resource": async (ctx) => {
    const { code, codeVerifier } = await approveAndGetCode(ctx, DEMO_CLIENT_ID);
    const token = await exchangeCode(ctx, { code, codeVerifier, clientId: DEMO_CLIENT_ID, resource: "https://not-a-registered-resource.example.com/mcp" });
      expect(token.status === 400, `undeclared resource should answer 400, got ${token.status}`);
      expect(token.body.error === "invalid_target", `error should be invalid_target, got ${token.body.error}`);
      ctx.log("Undeclared resource rejected", "400 invalid_target");
  },

  "wrong-code-verifier": async (ctx) => {
    const { code } = await approveAndGetCode(ctx, DEMO_CLIENT_ID);
    const token = await exchangeCode(ctx, { code, codeVerifier: randomBytes(32).toString("base64url"), clientId: DEMO_CLIENT_ID, resource: getDemoResourceUri() });
      expect(token.status === 400, `wrong verifier should answer 400, got ${token.status}`);
      expect(token.body.error === "invalid_grant", `error should be invalid_grant, got ${token.body.error}`);
      ctx.log("PKCE verifier check OK", "400 invalid_grant");
  },

  "code-replay": async (ctx) => {
    const { code, codeVerifier } = await approveAndGetCode(ctx, DEMO_CLIENT_ID);
    const first = await exchangeCode(ctx, { code, codeVerifier, clientId: DEMO_CLIENT_ID, resource: getDemoResourceUri() });
      expect(first.status === 200, `first exchange should answer 200, got ${first.status}`);
      const second = await exchangeCode(ctx, { code, codeVerifier, clientId: DEMO_CLIENT_ID, resource: getDemoResourceUri() });
      expect(second.status === 400, `replayed code must fail (expected 400, got ${second.status})`);
      ctx.log("Code replay rejected", `second exchange → 400 ${second.body.error}`);
  },

  "cross-resource-verifier": async (ctx) => {
    const { code, codeVerifier } = await approveAndGetCode(ctx, DEMO_CLIENT_ID);
    const token = await exchangeCode(ctx, { code, codeVerifier, clientId: DEMO_CLIENT_ID, resource: getDemoResourceUri() });
      expect(token.status === 200, `token exchange should answer 200, got ${token.status}`);
      const otherVerifier = createMcpTokenVerifier({
        projectId: getProjectId(),
        baseUrl: getApiBaseUrl(),
        resource: "https://some-other-resource.example.com/mcp",
      });
      try {
        await otherVerifier.verifyAccessToken(token.body.access_token);
        expect(false, "the other resource's verifier must reject the token");
      } catch (error) {
        if (!(error instanceof McpTokenVerificationError)) throw error;
        expect(error.reason === "wrong_resource", `rejection reason should be wrong_resource, got ${error.reason}`);
      }
      ctx.log("Resource binding OK", "wrong_resource from the other resource's verifier");
  },
};

export async function POST(request: Request) {
  const { testId, accessToken } = await request.json();
  const testCase = DEMO_TEST_CASES.find(candidate => candidate.id === testId);
  if (testCase === undefined) {
    return NextResponse.json({ error: `Unknown test id; known: ${DEMO_TEST_CASES.map(candidate => candidate.id).join(", ")}` }, { status: 400 });
  }
  const test = TESTS[testCase.id];
  if (typeof accessToken !== "string") {
    return NextResponse.json({ error: "accessToken is required (sign in on the demo page first)" }, { status: 400 });
  }

  const steps: Step[] = [];
  const ctx: Ctx = {
    log: (label, detail) => steps.push({ label, ...(detail === undefined ? {} : { detail }) }),
    clientHeaders: {
      "x-stack-access-type": "client",
      "x-stack-project-id": getProjectId(),
      "x-stack-publishable-client-key": process.env.NEXT_PUBLIC_HEXCLAVE_PUBLISHABLE_CLIENT_KEY ?? throwErr("NEXT_PUBLIC_HEXCLAVE_PUBLISHABLE_CLIENT_KEY is not set"),
      "x-stack-access-token": accessToken,
    },
    issuer: getIssuerUrl(),
  };

  try {
    await test(ctx);
    return NextResponse.json({ ok: true, title: testCase.title, steps });
  } catch (error) {
    if (!(error instanceof TestFailure)) console.error(`oauth-provider-demo test ${testId} threw unexpectedly:`, error);
    return NextResponse.json({
      ok: false,
      title: testCase.title,
      steps,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
