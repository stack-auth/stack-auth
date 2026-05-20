import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

function request(headers: Record<string, string>) {
  return new Request("http://127.0.0.1:26700/api/development-environment/health", { headers }) as any;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("development environment health route", () => {
  it("rejects arbitrary localhost origins", async () => {
    const response = await GET(request({
      host: "127.0.0.1:26700",
      origin: "http://evil.localhost:26700",
    }));

    expect(response.status).toBe(403);
  });

  it("does not reject the expected remote development environment dashboard origin", async () => {
    const response = await GET(request({
      host: "127.0.0.1:26700",
      origin: "http://127.0.0.1:26700",
    }));

    expect(response.status).not.toBe(403);
  });
});
