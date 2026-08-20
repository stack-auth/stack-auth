import { createServer } from "node:http";
import { afterEach, describe, expect, test } from "vitest";
import { cronFetch, getCronTransportTimeoutMs } from "./run-cron-jobs-transport";

const servers: ReturnType<typeof createServer>[] = [];

afterEach(() => {
  for (const server of servers.splice(0)) {
    server.close();
  }
});

describe("cron transport", () => {
  test("outlasts the workflow invocation backstop", () => {
    expect(getCronTransportTimeoutMs()).toBe(660_000);
  });

  test("allows a slow progressing response within the injected bound", async () => {
    const server = createServer((_request, response) => {
      response.write("first");
      setTimeout(() => response.end("last"), 20);
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const address = server.address();
    if (address == null || typeof address === "string") {
      throw new Error("Expected the test server to expose a TCP address.");
    }

    const response = await cronFetch(`http://127.0.0.1:${address.port}`, undefined, 100);

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe("firstlast");
  });

  test("fails a hung response at the injected absolute deadline", async () => {
    const server = createServer(() => {});
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const address = server.address();
    if (address == null || typeof address === "string") {
      throw new Error("Expected the test server to expose a TCP address.");
    }

    await expect(cronFetch(`http://127.0.0.1:${address.port}`, undefined, 20)).rejects.toThrow("absolute deadline");
  });
});
