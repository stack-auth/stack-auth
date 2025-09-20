import { it, localRedirectUrl } from "../helpers";
import { createApp } from "./js-helpers";

it("adds provider_scope from oauthScopesOnSignIn for authenticate flow", async ({ expect }) => {
  const { clientApp } = await createApp(
    {
      config: {
        oauthProviders: [
          {
            id: "github",
            type: "standard",
            clientId: "test_client_id",
            clientSecret: "test_client_secret",
          },
        ],
      },
    },
    {
      client: {
        oauthScopesOnSignIn: {
          github: ["repo"],
        },
      },
    }
  );

  // Patch window/document and call the real SDK API (signInWithOAuth)
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  let assignedUrl: string | null = null;
  globalThis.document = { cookie: "", createElement: () => ({}) } as any;
  globalThis.window = {
    location: {
      href: localRedirectUrl,
      assign: (url: string) => {
        assignedUrl = url;
        throw new Error("INTENTIONAL_TEST_ABORT");
      },
    },
  } as any;

  try {
    await expect(clientApp.signInWithOAuth("github")).rejects.toThrowError("INTENTIONAL_TEST_ABORT");
  } finally {
    globalThis.window = previousWindow;
    globalThis.document = previousDocument;
  }

  const parsed = new URL(assignedUrl!);
  expect(parsed.searchParams.get("provider_scope")).toBe("repo");
  const response = await fetch(assignedUrl!, { redirect: "manual" });
  expect(response).toMatchInlineSnapshot(`
    Response {
      "status": 307,
      "headers": Headers {
        "location": "https://github.com/login/oauth/authorize?client_id=test_client_id&scope=user%3Aemail+repo&response_type=code&redirect_uri=%3Cstripped+query+param%3E&code_challenge_method=S256&code_challenge=%3Cstripped+query+param%3E&state=%3Cstripped+query+param%3E&access_type=offline&prompt=consent",
        "set-cookie": <setting cookie "stack-oauth-inner-<stripped cookie name key>" at path "/" to "true">,
        <some fields may have been hidden>,
      },
    }
  `);
  const redirectUrl = new URL(response.headers.get("location")!);
  const scope = decodeURIComponent(redirectUrl.searchParams.get("scope")!);
  expect(scope).toBe("user:email repo");
}, { timeout: 40_000 });


