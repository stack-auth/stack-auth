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
        redirectMethod: "window",
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

it("does not resolve signInWithOAuth after a custom redirectMethod starts navigation", async ({ expect }) => {
  const navigatedUrls: string[] = [];
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
        redirectMethod: {
          useNavigate: () => (url) => {
            navigatedUrls.push(url);
          },
          navigate: (url) => {
            navigatedUrls.push(url);
          },
        },
      },
    }
  );

  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  globalThis.document = { cookie: "", createElement: () => ({}) } as any;
  globalThis.window = {
    location: {
      href: localRedirectUrl,
    },
  } as any;

  try {
    const redirectResult = clientApp.signInWithOAuth("github").then(() => "resolved");
    const result = await Promise.race([
      redirectResult,
      new Promise<string>((resolve) => setTimeout(() => resolve("pending"), 5000)),
    ]);

    expect(navigatedUrls).toHaveLength(1);
    expect(new URL(navigatedUrls[0]).pathname).toBe("/login/oauth/authorize");
    expect(result).toBe("pending");
  } finally {
    globalThis.window = previousWindow;
    globalThis.document = previousDocument;
  }
}, { timeout: 40_000 });
