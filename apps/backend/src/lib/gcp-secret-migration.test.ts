import { exportPKCS8, generateKeyPair } from "jose";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getGcpSecretId, migrateSecretsToGcp } from "./gcp-secret-migration";

async function createServiceAccountJson(): Promise<string> {
  const { privateKey } = await generateKeyPair("RS256", { extractable: true });
  return JSON.stringify({
    type: "service_account",
    project_id: "test-project",
    private_key: await exportPKCS8(privateKey),
    client_email: "migration@test-project.iam.gserviceaccount.com",
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("migrateSecretsToGcp", () => {
  it("uses the requested destination environment in the GCP secret ID", () => {
    expect(getGcpSecretId("HEXCLAVE_RESEND_API_KEY", "dev")).toBe("hexclave-secret-dev-HEXCLAVE_RESEND_API_KEY");
    expect(getGcpSecretId("HEXCLAVE_RESEND_API_KEY", "prod")).toBe("hexclave-secret-prod-HEXCLAVE_RESEND_API_KEY");
  });

  it("creates missing secrets without replacing existing secrets", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : input.toString();
      if (url === "https://oauth2.googleapis.com/token") {
        return Response.json({ access_token: "test-access-token" });
      }
      if (url.endsWith("/secrets/SECRET_TO_CREATE")) {
        return new Response(null, { status: 404 });
      }
      if (url.endsWith("/secrets/SECRET_TO_KEEP")) {
        return Response.json({});
      }
      if (url.includes("/secrets?secretId=SECRET_TO_CREATE")) {
        return Response.json({});
      }
      if (url.endsWith("/secrets/SECRET_TO_CREATE:addVersion")) {
        expect(init?.body).toBe(JSON.stringify({
          payload: {
            data: Buffer.from("secret-value", "utf8").toString("base64"),
          },
        }));
        return Response.json({});
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await migrateSecretsToGcp(
      await createServiceAccountJson(),
      [
        { id: "SECRET_TO_CREATE", value: "secret-value" },
        { id: "SECRET_TO_KEEP", value: "existing-value" },
      ],
      false,
      "test-project",
    );

    expect(result).toEqual({
      created: ["SECRET_TO_CREATE"],
      skippedExisting: ["SECRET_TO_KEEP"],
      wouldCreate: [],
    });
  });

  it("does not create versions during a dry run", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = input instanceof Request ? input.url : input.toString();
      if (url === "https://oauth2.googleapis.com/token") {
        return Response.json({ access_token: "test-access-token" });
      }
      if (url.endsWith("/secrets/SECRET_TO_CREATE")) {
        return new Response(null, { status: 404 });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await migrateSecretsToGcp(
      await createServiceAccountJson(),
      [{ id: "SECRET_TO_CREATE", value: "secret-value" }],
      true,
      "test-project",
    );

    expect(result).toEqual({
      created: [],
      skippedExisting: [],
      wouldCreate: ["SECRET_TO_CREATE"],
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
