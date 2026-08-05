import { expect, test, vi } from "vitest";

const timeoutState = vi.hoisted(() => ({
  aborted: false,
  cleanupFinished: false,
}));

vi.mock("@/generated/route-modules", () => ({
  httpMethodNames: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"] as const,
  routeModules: [{
    normalizedPath: "/api/migrations/v2beta2/migration-tests/smart-route-handler",
    load: async () => ({
      GET: async (request: Request) => await new Promise<Response>((resolve) => {
        request.signal.addEventListener("abort", () => {
          timeoutState.aborted = true;
          setTimeout(() => {
            timeoutState.cleanupFinished = true;
            resolve(new Response("late response"));
          }, 1);
        }, { once: true });
      }),
    }),
  }],
}));

vi.mock("./request-lifetime", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./request-lifetime")>();
  return {
    ...actual,
    createRequestLifetime: (input: { normalizedPath: string }) => new actual.RequestLifetime({
      drainGraceMs: 50,
      maxDurationMs: 200,
      normalizedPath: input.normalizedPath,
      startedAt: performance.now(),
      terminationBufferMs: 20,
    }),
  };
});

test("the Elysia dispatcher aborts, drains, and returns 504 at a route deadline", async () => {
  const { app } = await import("./app");
  const response = await app.handle(new Request(
    "http://localhost/api/v2beta1/migration-tests/smart-route-handler",
  ));

  expect({
    status: response.status,
    body: await response.text(),
    cors: response.headers.get("access-control-allow-origin"),
    contentTypeProtection: response.headers.get("x-content-type-options"),
    aborted: timeoutState.aborted,
    cleanupFinished: timeoutState.cleanupFinished,
  }).toEqual({
    status: 504,
    body: "Gateway Timeout",
    cors: "*",
    contentTypeProtection: "nosniff",
    aborted: true,
    cleanupFinished: true,
  });
});
