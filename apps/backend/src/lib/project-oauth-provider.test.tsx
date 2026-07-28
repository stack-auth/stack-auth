import { describe, expect, it, vi } from "vitest";
import * as oauthSsrf from "./ssrf-protection/oauth";
import { resolveClientIdMetadataDocument } from "./project-oauth-provider";
import { Tenancy } from "./tenancies";

const clientId = "https://clients.example.com/client.json";

function createMockTenancy(): Tenancy {
  return {
    config: {
      oauthProvider: {
        clientIdMetadataDocuments: {
          enabled: true,
          allowedDomains: {},
        },
      },
    },
    project: { id: "12345678-1234-4234-8234-123456789abc" },
  } as Tenancy;
}

describe("resolveClientIdMetadataDocument", () => {
  it.each([
    ["network failure", new Error("connection refused")],
    ["non-2xx response", new Error("status 503")],
    ["non-JSON body", new SyntaxError("unexpected token")],
    ["oversized body", new Error("document exceeds the size limit")],
  ])("fails closed on %s", async (_name, failure) => {
    const fetchDocument = vi.spyOn(oauthSsrf, "fetchOAuthJsonDocument").mockRejectedValue(failure);
    try {
      await expect(resolveClientIdMetadataDocument(createMockTenancy(), clientId)).resolves.toBeUndefined();
    } finally {
      fetchDocument.mockRestore();
    }
  });

  it("rejects a document whose client_id does not match the metadata URL", async () => {
    const fetchDocument = vi.spyOn(oauthSsrf, "fetchOAuthJsonDocument").mockResolvedValue({
      client_id: "https://clients.example.com/other.json",
      redirect_uris: ["https://example.com/callback"],
    });
    try {
      await expect(resolveClientIdMetadataDocument(createMockTenancy(), clientId)).resolves.toBeUndefined();
    } finally {
      fetchDocument.mockRestore();
    }
  });

  it("accepts a valid client metadata document", async () => {
    const fetchDocument = vi.spyOn(oauthSsrf, "fetchOAuthJsonDocument").mockResolvedValue({
      client_id: clientId,
      client_name: "Example MCP client",
      redirect_uris: ["http://127.0.0.1:8765/callback"],
    });
    try {
      await expect(resolveClientIdMetadataDocument(createMockTenancy(), clientId)).resolves.toMatchObject({
        client_id: clientId,
        redirect_uris: ["http://127.0.0.1:8765/callback"],
        token_endpoint_auth_method: "none",
      });
    } finally {
      fetchDocument.mockRestore();
    }
  });
});
