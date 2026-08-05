import { node } from "@elysia/node";
import { Elysia } from "elysia";
import type { Server as ElysiaServer } from "elysia/universal";
import { Server as NodeHttpServer } from "node:http";
import { describe, expect, it } from "vitest";

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
      const nodeServer = getNodeServer(boundServer);
      if (nodeServer.listening) {
        resolve(boundServer);
      } else {
        const onError = (error: Error) => reject(error);
        nodeServer.once("error", onError);
        nodeServer.once("listening", () => {
          nodeServer.off("error", onError);
          resolve(boundServer);
        });
      }
    });
  });
  const address = getNodeServer(server).address();
  if (address == null || typeof address === "string") {
    throw new Error("Node did not assign an IPv4 test port");
  }
  return { port: address.port, server };
}

function getNodeServer(server: ElysiaServer): NodeHttpServer {
  if (!("raw" in server)) {
    throw new Error("Elysia did not expose the srvx server handle");
  }
  const rawServer = server.raw;
  if (typeof rawServer !== "object" || rawServer == null || !("node" in rawServer)) {
    throw new Error("srvx did not expose its Node adapter");
  }
  const nodeAdapter = rawServer.node;
  if (typeof nodeAdapter !== "object" || nodeAdapter == null || !("server" in nodeAdapter)) {
    throw new Error("srvx did not expose its Node HTTP server");
  }
  const nodeServer = nodeAdapter.server;
  if (!(nodeServer instanceof NodeHttpServer)) {
    throw new Error("srvx returned an unexpected Node HTTP server handle");
  }
  return nodeServer;
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
