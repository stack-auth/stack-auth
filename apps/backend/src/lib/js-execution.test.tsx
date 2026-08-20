import { createServer } from "node:http";
import { afterEach, describe, expect, test } from "vitest";
import { freestyleFetch, getFreestyleTransportTimeoutMs } from "./js-execution";

const servers: ReturnType<typeof createServer>[] = [];

afterEach(() => {
  for (const server of servers.splice(0)) {
    server.close();
  }
});

describe("Freestyle transport", () => {
  test("adds a margin to the workflow engine execution timeout", () => {
    expect(getFreestyleTransportTimeoutMs(630_000)).toBe(660_000);
    expect(getFreestyleTransportTimeoutMs(undefined)).toBe(60_000);
  });

  test("accepts a delayed JSON response without the global fetch headers timeout", async () => {
    const server = createServer((_request, response) => {
      setTimeout(() => {
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify({ result: { status: "ok", data: "done" } }));
      }, 20);
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const address = server.address();
    if (address == null || typeof address === "string") {
      throw new Error("Expected the test server to expose a TCP address.");
    }

    const response = await freestyleFetch(
      `http://127.0.0.1:${address.port}`,
      { method: "POST", body: JSON.stringify({ config: { timeout: 1 } }) },
      1,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ result: { status: "ok", data: "done" } });
  });
});
