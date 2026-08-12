import { captureError } from "@hexclave/shared/dist/utils/errors";
import { isRequestBodyTooLargeError } from "./request-body-limit";

function createUncaughtErrorResponse() {
  return new Response("Internal Server Error", {
    status: 500,
    headers: {
      "content-type": "text/plain; charset=utf-8",
    },
  });
}

export function handleUncaughtBackendError(error: unknown) {
  // Non-smart routes (e.g. the oidc-provider routes) read the request body directly, so srvx's
  // ERR_BODY_TOO_LARGE abort bubbles all the way up here. It's a client-caused condition, so we
  // answer with a 413 and deliberately skip captureError — it's not a server error.
  if (isRequestBodyTooLargeError(error)) {
    return new Response("Payload Too Large", {
      status: 413,
      headers: {
        "content-type": "text/plain; charset=utf-8",
      },
    });
  }
  captureError("backend-global-error", error);
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

import.meta.vitest?.test("body-too-large errors become a 413 instead of a sanitized 500", async ({ expect }) => {
  const response = handleUncaughtBackendError(Object.assign(new Error("too large"), { code: "ERR_BODY_TOO_LARGE" }));

  expect({
    status: response.status,
    contentType: response.headers.get("content-type"),
    body: await response.text(),
  }).toMatchInlineSnapshot(`
    {
      "body": "Payload Too Large",
      "contentType": "text/plain; charset=utf-8",
      "status": 413,
    }
  `);
});

import.meta.vitest?.test("ordinary uncaught errors still produce the sanitized 500", async ({ expect }) => {
  const response = handleUncaughtBackendError(new Error("some internal detail that must not leak"));

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
