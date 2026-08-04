import { captureError } from "@hexclave/shared/dist/utils/errors";

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
