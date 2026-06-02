import { afterEach, describe, expect, it, vi } from "vitest";

function request(headers: Record<string, string>) {
  return new Request("http://127.0.0.1:26700/api/development-environment/health", { headers }) as any;
}

async function getHealthResponse(req: Request) {
  const { GET } = await import("./route");
  return await GET(req as any);
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("development environment health route", () => {
  it("rejects arbitrary localhost origins", async () => {
    const response = await getHealthResponse(request({
      host: "127.0.0.1:26700",
      origin: "http://evil.localhost:26700",
    }));

    expect(response.status).toBe(403);
  });

  it("does not reject the expected remote development environment dashboard origin", async () => {
    const response = await getHealthResponse(request({
      host: "127.0.0.1:26700",
      origin: "http://127.0.0.1:26700",
    }));

    expect(response.status).not.toBe(403);
  });

  it("uses the configured local dashboard port for allowed origins", async () => {
    vi.stubEnv("NEXT_PUBLIC_HEXCLAVE_LOCAL_DASHBOARD_PORT", "26701");
    const response = await getHealthResponse(new Request("http://127.0.0.1:26701/api/development-environment/health", {
      headers: {
        host: "127.0.0.1:26701",
        origin: "http://127.0.0.1:26701",
      },
    }));

    expect(response.status).not.toBe(403);
  });
});
