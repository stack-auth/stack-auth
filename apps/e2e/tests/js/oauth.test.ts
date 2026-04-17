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

  // The SDK now receives the OAuth provider URL directly via JSON response
  const oauthUrl = new URL(assignedUrl!);
  const scope = decodeURIComponent(oauthUrl.searchParams.get("scope")!);
  expect(scope).toBe("user:email repo");
}, { timeout: 40_000 });


