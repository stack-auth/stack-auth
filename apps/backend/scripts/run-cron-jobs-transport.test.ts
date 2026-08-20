import { createServer } from "node:http";
import type { Socket } from "node:net";
import { afterEach, describe, expect, test } from "vitest";
import { nodeHttpTransport } from "../src/lib/node-http-transport";
import { CRON_ENDPOINTS, CRON_WORKFLOW_ENGINE_ENDPOINT, getCronTransportTimeoutMs } from "./run-cron-jobs-config";

const servers: { server: ReturnType<typeof createServer>, sockets: Set<Socket> }[] = [];

function registerServer(server: ReturnType<typeof createServer>): ReturnType<typeof createServer> {
  const sockets = new Set<Socket>();
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  servers.push({ server, sockets });
  return server;
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map(async ({ server, sockets }) => {
    for (const socket of sockets) {
      socket.destroy();
    }
    if (!server.listening) return;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error != null) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }));
});

describe("cron transport", () => {
  test("outlasts the workflow invocation backstop", () => {
    expect(CRON_ENDPOINTS).toContain(CRON_WORKFLOW_ENGINE_ENDPOINT);
    expect(getCronTransportTimeoutMs(CRON_WORKFLOW_ENGINE_ENDPOINT.maxDurationMs)).toBe(840_000);
  });

  test("allows a slow progressing response within the injected bound", async () => {
    const server = createServer((_request, response) => {
      response.write("first");
      setTimeout(() => response.end("last"), 20);
    });
    registerServer(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const address = server.address();
    if (address == null || typeof address === "string") {
      throw new Error("Expected the test server to expose a TCP address.");
    }

    const response = await nodeHttpTransport(`http://127.0.0.1:${address.port}`, undefined, 100);

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe("firstlast");
  });

  test("fails a hung response at the injected absolute deadline", async () => {
    const server = createServer(() => {});
    registerServer(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const address = server.address();
    if (address == null || typeof address === "string") {
      throw new Error("Expected the test server to expose a TCP address.");
    }

    await expect(nodeHttpTransport(`http://127.0.0.1:${address.port}`, undefined, 20)).rejects.toThrow("absolute deadline");
  });

  test("fails an unending request body at the injected absolute deadline", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("partial"));
      },
      cancel() {
        return new Promise<never>(() => {});
      },
    });

    const startedAt = performance.now();
    await expect(nodeHttpTransport("http://127.0.0.1:1", {
      method: "POST",
      body,
    }, 20)).rejects.toThrow("absolute deadline");
    expect(performance.now() - startedAt).toBeLessThan(200);
  });

  test("does not restart the full deadline after reading a request body", async () => {
    const server = createServer((_request, response) => {
      setTimeout(() => response.end("done"), 45);
    });
    registerServer(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const address = server.address();
    if (address == null || typeof address === "string") {
      throw new Error("Expected the test server to expose a TCP address.");
    }

    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("partial"));
        setTimeout(() => controller.close(), 45);
      },
    });

    await expect(nodeHttpTransport(`http://127.0.0.1:${address.port}`, {
      method: "POST",
      body,
    }, 80)).rejects.toThrow("absolute deadline");
  });
});
