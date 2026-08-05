import { node } from "@elysia/node";
import { Elysia } from "elysia";
import type { Server as ElysiaServer } from "elysia/universal";
import { createServer } from "node:net";
import { setTimeout as wait } from "node:timers/promises";
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
  const port = await getAvailablePort();
  const testApp = new Elysia({ adapter: node() })
    .get("/url", ({ request }) => request.url);
  const listenOptions = {
    hostname: "127.0.0.1",
    port,
    trustProxy,
  };
  let server: ElysiaServer | undefined;
  testApp.listen(listenOptions, (boundServer) => {
    server = boundServer;
  });
  // srvx invokes Elysia's listen callback before Node emits its listening event.
  await wait(25);
  if (server == null) {
    throw new Error("Elysia did not provide its bound server handle");
  }
  return { port, server };
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

async function getAvailablePort(): Promise<number> {
  const reservation = createServer();
  await new Promise<void>((resolve, reject) => {
    reservation.once("error", reject);
    reservation.listen(0, "127.0.0.1", resolve);
  });
  const address = reservation.address();
  await new Promise<void>((resolve, reject) => reservation.close((error) => error == null ? resolve() : reject(error)));
  if (address == null || typeof address === "string") {
    throw new Error("Node did not assign an IPv4 test port");
  }
  return address.port;
}
