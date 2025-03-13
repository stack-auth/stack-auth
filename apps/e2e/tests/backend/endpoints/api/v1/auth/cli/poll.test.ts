import { it } from "../../../../../../helpers";
import { niceBackendFetch } from "../../../../../backend-helpers";

it("should return 'waiting' status when polling for a new CLI auth attempt", async ({ expect }) => {
  // First, create a new CLI auth attempt
  const createResponse = await niceBackendFetch("/api/latest/auth/cli", {
    method: "POST",
    accessType: "server",
    body: {},
  });

  const pollingCode = createResponse.body.polling_code;

  // Then poll for the status
  const pollResponse = await niceBackendFetch("/api/latest/auth/cli/poll", {
    method: "POST",
    accessType: "server",
    body: { polling_code: pollingCode },
  });

  expect(pollResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": { "status": "waiting" },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("should return 400 with INVALID_POLLING_CODE error when polling with an invalid code", async ({ expect }) => {
  const pollResponse = await niceBackendFetch("/api/latest/auth/cli/poll", {
    method: "POST",
    accessType: "server",
    body: { polling_code: "invalid-code" },
  });

  expect(pollResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": {
        "code": "INVALID_POLLING_CODE",
        "error": "The polling code is invalid or does not exist.",
      },
      "headers": Headers {
        "x-stack-known-error": "INVALID_POLLING_CODE",
        <some fields may have been hidden>,
      },
    }
  `);
});

it("should return 'expired' status when polling for an expired CLI auth attempt", async ({ expect }) => {
  // First, create a new CLI auth attempt with a very short expiration time
  const createResponse = await niceBackendFetch("/api/latest/auth/cli", {
    method: "POST",
    accessType: "server",
    body: {
      expires_in_millis: 1000, // 1 second
    },
  });

  const pollingCode = createResponse.body.polling_code;

  // Wait for the CLI auth attempt to expire
  await new Promise(resolve => setTimeout(resolve, 1500)); // Wait 1.5 seconds

  // Then poll for the status
  const pollResponse = await niceBackendFetch("/api/latest/auth/cli/poll", {
    method: "POST",
    accessType: "server",
    body: { polling_code: pollingCode },
  });

  expect(pollResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": { "status": "expired" },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});
