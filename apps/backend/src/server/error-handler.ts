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
