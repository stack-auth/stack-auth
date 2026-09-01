import { afterEach, describe, expect, it, vi } from "vitest";
import { googleAccessToken, resetGoogleAuthCacheForTests } from "./auth.js";

afterEach(() => {
  resetGoogleAuthCacheForTests();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function stubFederationEnv(): void {
  vi.stubEnv("HEXCLAVE_MARSHAL_GCP_WORKLOAD_IDENTITY_AUDIENCE", "//iam.googleapis.com/projects/1/locations/global/workloadIdentityPools/vercel/providers/vercel");
  vi.stubEnv("HEXCLAVE_MARSHAL_GCP_WORKLOAD_IDENTITY_SERVICE_ACCOUNT", "marshal-controller@platform.iam.gserviceaccount.com");
  vi.stubEnv("GOOGLE_APPLICATION_CREDENTIALS", "");
}

describe("workload identity federation", () => {
  it("exchanges the host's OIDC assertion and impersonates the controller service account", async () => {
    stubFederationEnv();
    vi.stubEnv("VERCEL_OIDC_TOKEN", "header.payload.signature");
    const expireTime = new Date(Date.now() + 3600_000).toISOString();
    const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => url.startsWith("https://sts.googleapis.com/")
      ? new Response(JSON.stringify({ access_token: "federated-token", expires_in: 3600 }), { status: 200 })
      : new Response(JSON.stringify({ accessToken: "impersonated-token", expireTime }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    expect(await googleAccessToken()).toBe("impersonated-token");

    const [stsUrl, stsInit] = fetchMock.mock.calls[0];
    expect(stsUrl).toBe("https://sts.googleapis.com/v1/token");
    expect(String(stsInit?.body)).toContain("subject_token=header.payload.signature");
    const [impersonationUrl, impersonationInit] = fetchMock.mock.calls[1];
    expect(impersonationUrl).toBe("https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/marshal-controller%40platform.iam.gserviceaccount.com:generateAccessToken");
    expect((impersonationInit?.headers as Record<string, string>).authorization).toBe("Bearer federated-token");
  });

  it("re-reads the assertion on every refresh, because the host reinjects it per invocation", async () => {
    stubFederationEnv();
    vi.stubEnv("VERCEL_OIDC_TOKEN", "first-assertion");
    // Already expired, so the second call cannot be served from cache.
    const expireTime = new Date(Date.now() - 1000).toISOString();
    const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => url.startsWith("https://sts.googleapis.com/")
      ? new Response(JSON.stringify({ access_token: "federated-token" }), { status: 200 })
      : new Response(JSON.stringify({ accessToken: "impersonated-token", expireTime }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await googleAccessToken();
    vi.stubEnv("VERCEL_OIDC_TOKEN", "second-assertion");
    await googleAccessToken();

    expect(String(fetchMock.mock.calls[2][1]?.body)).toContain("subject_token=second-assertion");
  });

  it("fails loudly when the host injected no assertion", async () => {
    stubFederationEnv();
    vi.stubEnv("VERCEL_OIDC_TOKEN", "");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));

    await expect(googleAccessToken()).rejects.toThrow(/VERCEL_OIDC_TOKEN is empty/);
  });

  it("refuses half-configured federation instead of falling through to the metadata server", async () => {
    vi.stubEnv("HEXCLAVE_MARSHAL_GCP_WORKLOAD_IDENTITY_AUDIENCE", "//iam.googleapis.com/projects/1/locations/global/workloadIdentityPools/vercel/providers/vercel");
    vi.stubEnv("HEXCLAVE_MARSHAL_GCP_WORKLOAD_IDENTITY_SERVICE_ACCOUNT", "");

    await expect(googleAccessToken()).rejects.toThrow(/needs both/);
  });

  it("never caches a token whose expiry it could not parse", async () => {
    stubFederationEnv();
    vi.stubEnv("VERCEL_OIDC_TOKEN", "header.payload.signature");
    vi.stubGlobal("fetch", vi.fn(async (url: string) => url.startsWith("https://sts.googleapis.com/")
      ? new Response(JSON.stringify({ access_token: "federated-token" }), { status: 200 })
      : new Response(JSON.stringify({ accessToken: "impersonated-token", expireTime: "whenever" }), { status: 200 })));

    await expect(googleAccessToken()).rejects.toThrow(/unparseable expiry/);
  });

  it("does not report the STS response body, which can echo the assertion back", async () => {
    stubFederationEnv();
    vi.stubEnv("VERCEL_OIDC_TOKEN", "header.payload.signature");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "invalid_grant", subject_token: "header.payload.signature" }), { status: 400 })));

    await expect(googleAccessToken()).rejects.toThrow(/^Google STS token exchange failed with HTTP 400$/);
  });
});
