import { describe, expect, it, vi } from "vitest";
import * as oauthSsrf from "./ssrf-protection/oauth";
import { getProjectResourceServers, getProjectStaticClients, resolveClientIdMetadataDocument } from "./project-oauth-provider";
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
        scopes: {},
        clients: {},
      },
      rbac: { permissions: {} },
    },
    project: { id: "12345678-1234-4234-8234-123456789abc" },
  // Tenancy is an inferred Prisma payload with a large config surface; this test intentionally
  // supplies only the normalized fields consumed by the metadata resolver.
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
      await expect(resolveClientIdMetadataDocument(createMockTenancy(), clientId)).resolves.toMatchInlineSnapshot(`
        {
          "application_type": "native",
          "client_id": "https://clients.example.com/client.json",
          "client_name": "Example MCP client",
          "grant_types": [
            "authorization_code",
            "refresh_token",
          ],
          "redirect_uris": [
            "http://127.0.0.1:8765/callback",
          ],
          "response_types": [
            "code",
          ],
          "token_endpoint_auth_method": "none",
        }
      `);
    } finally {
      fetchDocument.mockRestore();
    }
  });

  it("skips static clients whose redirect URI rows are all incomplete", () => {
    const tenancy = createMockTenancy();
    tenancy.config.oauthProvider.clients = {
      incomplete: {
        type: "public",
        displayName: "Incomplete",
        trusted: false,
        redirectUris: {
          first: { url: undefined },
        },
      },
    };
    expect(getProjectStaticClients(tenancy)).toMatchInlineSnapshot(`[]`);
  });

  it("canonicalizes resource URI trailing slashes before issuing resource metadata", () => {
    const tenancy = createMockTenancy();
    tenancy.config.oauthProvider.resources = {
      mcp: {
        displayName: "MCP",
        uri: "https://mcp.example.com/mcp/",
        scopes: {},
      },
    };
    expect([...getProjectResourceServers(tenancy).keys()]).toMatchInlineSnapshot(`
      [
        "https://mcp.example.com/mcp",
      ]
    `);
  });
});
