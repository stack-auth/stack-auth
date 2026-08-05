import { captureError } from "@hexclave/shared/dist/utils/errors";
import { RouteTimeoutError } from "./request-lifetime";

function createUncaughtErrorResponse() {
  return new Response("Internal Server Error", {
    status: 500,
    headers: {
      "content-type": "text/plain; charset=utf-8",
    },
  });
}

export function handleUncaughtBackendError(error: unknown) {
  captureError("backend-global-error", error);
  if (error instanceof RouteTimeoutError) {
    return new Response("Gateway Timeout", {
      status: 504,
      headers: {
        "content-type": "text/plain; charset=utf-8",
      },
    });
  }
  return createUncaughtErrorResponse();
}

import.meta.vitest?.test("uncaught backend errors do not expose internal details", async ({ expect }) => {
  const response = createUncaughtErrorResponse();

  expect({
    status: response.status,
    contentType: response.headers.get("content-type"),
    body: await response.text(),
  }).toMatchInlineSnapshot(`
    {
      "body": "Internal Server Error",
      "contentType": "text/plain; charset=utf-8",
      "status": 500,
    }
  `);
});

import.meta.vitest?.test("route timeouts return a sanitized gateway timeout", async ({ expect }) => {
  const response = handleUncaughtBackendError(new RouteTimeoutError("/api/latest/test", 300_000));

  expect({
    status: response.status,
    contentType: response.headers.get("content-type"),
    body: await response.text(),
  }).toEqual({
    status: 504,
    contentType: "text/plain; charset=utf-8",
    body: "Gateway Timeout",
  });
});
