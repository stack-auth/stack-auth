import { validateStandaloneTrustedProxyConfiguration, type TrustedProxy } from "@/lib/trusted-proxy";
import { node } from "@elysia/node";
import { Elysia } from "elysia";
import type { Server as ElysiaServer } from "elysia/universal";
import { describe, expect, it } from "vitest";
import { getNodeServer, waitForNodeServerToListen } from "./node-server";

describe("standalone trusted proxy configuration", () => {
  it.each(["production", "staging", "preview", ""])(
    "rejects an HTTPS public API URL without proxy trust in the %j environment",
    (nodeEnvironment) => {
      expect(() => validateStandaloneTrustedProxyConfiguration({
        nodeEnvironment,
        publicApiUrl: "https://auth-api.example.com",
        trustedProxy: "",
      })).toThrow("HEXCLAVE_TRUSTED_PROXY must be configured");
    },
  );

  it.each(["development", "test"])(
    "allows an HTTPS public API URL without proxy trust in the %s environment",
    (nodeEnvironment) => {
      expect(() => validateStandaloneTrustedProxyConfiguration({
        nodeEnvironment,
        publicApiUrl: "https://auth-api.example.com",
        trustedProxy: "",
      })).not.toThrow();
    },
  );

  it("allows a plain-HTTP local standalone deployment without proxy trust", () => {
    expect(() => validateStandaloneTrustedProxyConfiguration({
      nodeEnvironment: "production",
      publicApiUrl: "http://localhost:8102",
      trustedProxy: "",
    })).not.toThrow();
  });

  const trustedProxies = ["generic", "vercel", "cloudflare", "cloudrun"] satisfies TrustedProxy[];
  it.each(trustedProxies)("allows HTTPS when the %s proxy is explicitly trusted", (trustedProxy) => {
    expect(() => validateStandaloneTrustedProxyConfiguration({
      nodeEnvironment: "production",
      publicApiUrl: "https://auth-api.example.com",
      trustedProxy,
    })).not.toThrow();
  });
});

describe("Elysia Node trusted proxy configuration", () => {
  it("only uses forwarded protocol and host metadata when proxy trust is enabled", async () => {
    const trusted = await startUrlEchoServer(true);
    try {
      expect(await fetchForwardedUrl(trusted.port)).toBe("https://api.example.com/url");
    } finally {
      await trusted.server.stop();
    }

    const untrusted = await startUrlEchoServer(false);
    try {
      expect(await fetchForwardedUrl(untrusted.port)).toBe(`http://127.0.0.1:${untrusted.port}/url`);
    } finally {
      await untrusted.server.stop();
    }
  });
});

async function startUrlEchoServer(trustProxy: boolean) {
  const testApp = new Elysia({ adapter: node() })
    .get("/url", ({ request }) => request.url);
  const listenOptions = {
    hostname: "127.0.0.1",
    port: 0,
    trustProxy,
  };
  const server = await new Promise<ElysiaServer>((resolve, reject) => {
    testApp.listen(listenOptions, (boundServer) => {
      waitForNodeServerToListen(boundServer).then(resolve, reject);
    });
  });
  const address = getNodeServer(server).address();
  if (address == null || typeof address === "string") {
    throw new Error("Node did not assign an IPv4 test port");
  }
  return { port: address.port, server };
}

async function fetchForwardedUrl(port: number) {
  const response = await fetch(`http://127.0.0.1:${port}/url`, {
    headers: {
      "x-forwarded-host": "api.example.com",
      "x-forwarded-proto": "https",
    },
  });
  return await response.text();
}
