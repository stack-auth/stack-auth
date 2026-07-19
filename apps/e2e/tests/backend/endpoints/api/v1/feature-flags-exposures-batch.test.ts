import { randomUUID } from "node:crypto";
import { it } from "../../../../helpers";
import { Auth, Project, niceBackendFetch } from "../../../backend-helpers";

// E2E tests for POST /api/v1/feature-flags/exposures/batch.
//
// NOTE: there is no flag evaluation endpoint yet (it lands with the
// feature-flags core workstream), so e2e tests cannot mint a real signed
// evaluation token. This file therefore only covers the negative paths;
// positive-path coverage (valid tokens round-tripping into exposure rows)
// lives in the backend unit tests
// (apps/backend/src/lib/feature-flags/exposure-tokens.test.ts) until the
// evaluation endpoint exists.

async function uploadExposureBatch(options: {
  batchId: string,
  exposures: { event_id: string, token: string, event_at_ms: number }[],
}) {
  return await niceBackendFetch("/api/v1/feature-flags/exposures/batch", {
    method: "POST",
    accessType: "client",
    body: {
      batch_id: options.batchId,
      exposures: options.exposures,
    },
  });
}

it("throws error when analytics is not enabled", async ({ expect }) => {
  await Project.createAndSwitch({ config: { magic_link_enabled: true } });
  // Analytics is disabled by default - do NOT call Project.updateConfig
  await Auth.Otp.signIn();

  const res = await uploadExposureBatch({
    batchId: randomUUID(),
    exposures: [{ event_id: randomUUID(), token: "some-token", event_at_ms: Date.now() }],
  });

  expect(res.status).toBe(400);
  expect(res.body?.code).toBe("ANALYTICS_NOT_ENABLED");
});

it("rejects a garbage token with 401", async ({ expect }) => {
  await Project.createAndSwitch({ config: { magic_link_enabled: true } });
  await Project.updateConfig({ apps: { installed: { analytics: { enabled: true } } } });
  await Auth.Otp.signIn();

  const res = await uploadExposureBatch({
    batchId: randomUUID(),
    exposures: [{ event_id: randomUUID(), token: "not-a-valid-jwt", event_at_ms: Date.now() }],
  });

  expect(res).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 401,
      "body": "Invalid or expired feature flag evaluation token",
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("rejects tokens longer than 4096 characters at the schema level", async ({ expect }) => {
  await Project.createAndSwitch({ config: { magic_link_enabled: true } });
  await Project.updateConfig({ apps: { installed: { analytics: { enabled: true } } } });
  await Auth.Otp.signIn();

  const res = await uploadExposureBatch({
    batchId: randomUUID(),
    exposures: [{ event_id: randomUUID(), token: "a".repeat(4097), event_at_ms: Date.now() }],
  });

  expect(res).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": {
        "code": "SCHEMA_ERROR",
        "details": {
          "message": deindent\`
            Request validation failed on POST /api/v1/feature-flags/exposures/batch:
              - body.exposures[0].token must be at most 4096 characters
          \`,
        },
        "error": deindent\`
          Request validation failed on POST /api/v1/feature-flags/exposures/batch:
            - body.exposures[0].token must be at most 4096 characters
        \`,
      },
      "headers": Headers {
        "x-stack-known-error": "SCHEMA_ERROR",
        <some fields may have been hidden>,
      },
    }
  `);
});

it("rejects empty exposures array", async ({ expect }) => {
  await Project.createAndSwitch({ config: { magic_link_enabled: true } });
  await Project.updateConfig({ apps: { installed: { analytics: { enabled: true } } } });
  await Auth.Otp.signIn();

  const res = await uploadExposureBatch({
    batchId: randomUUID(),
    exposures: [],
  });

  expect(res).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": {
        "code": "SCHEMA_ERROR",
        "details": {
          "message": deindent\`
            Request validation failed on POST /api/v1/feature-flags/exposures/batch:
              - body.exposures field must have at least 1 items
          \`,
        },
        "error": deindent\`
          Request validation failed on POST /api/v1/feature-flags/exposures/batch:
            - body.exposures field must have at least 1 items
        \`,
      },
      "headers": Headers {
        "x-stack-known-error": "SCHEMA_ERROR",
        <some fields may have been hidden>,
      },
    }
  `);
});

it("rejects too many exposures (>500)", async ({ expect }) => {
  await Project.createAndSwitch({ config: { magic_link_enabled: true } });
  await Project.updateConfig({ apps: { installed: { analytics: { enabled: true } } } });
  await Auth.Otp.signIn();

  const now = Date.now();
  const res = await uploadExposureBatch({
    batchId: randomUUID(),
    exposures: Array.from({ length: 501 }, () => ({
      event_id: randomUUID(),
      token: "some-token",
      event_at_ms: now,
    })),
  });

  expect(res).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": {
        "code": "SCHEMA_ERROR",
        "details": {
          "message": deindent\`
            Request validation failed on POST /api/v1/feature-flags/exposures/batch:
              - body.exposures field must have less than or equal to 500 items
          \`,
        },
        "error": deindent\`
          Request validation failed on POST /api/v1/feature-flags/exposures/batch:
            - body.exposures field must have less than or equal to 500 items
        \`,
      },
      "headers": Headers {
        "x-stack-known-error": "SCHEMA_ERROR",
        <some fields may have been hidden>,
      },
    }
  `);
});

it("rejects exposures with event_at_ms too far in the past", async ({ expect }) => {
  await Project.createAndSwitch({ config: { magic_link_enabled: true } });
  await Project.updateConfig({ apps: { installed: { analytics: { enabled: true } } } });
  await Auth.Otp.signIn();

  // The timestamp bounds are checked before token verification, so a garbage
  // token is fine here — the request must fail on the timestamp.
  const res = await uploadExposureBatch({
    batchId: randomUUID(),
    exposures: [{ event_id: randomUUID(), token: "some-token", event_at_ms: Date.now() - 25 * 60 * 60 * 1000 }],
  });

  expect(res).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": "Exposure event_at_ms is too far in the past or future",
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("rejects invalid event_id", async ({ expect }) => {
  await Project.createAndSwitch({ config: { magic_link_enabled: true } });
  await Project.updateConfig({ apps: { installed: { analytics: { enabled: true } } } });
  await Auth.Otp.signIn();

  const res = await uploadExposureBatch({
    batchId: randomUUID(),
    exposures: [{ event_id: "not-a-uuid", token: "some-token", event_at_ms: Date.now() }],
  });

  expect(res).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": {
        "code": "SCHEMA_ERROR",
        "details": {
          "message": deindent\`
            Request validation failed on POST /api/v1/feature-flags/exposures/batch:
              - Invalid event_id
          \`,
        },
        "error": deindent\`
          Request validation failed on POST /api/v1/feature-flags/exposures/batch:
            - Invalid event_id
        \`,
      },
      "headers": Headers {
        "x-stack-known-error": "SCHEMA_ERROR",
        <some fields may have been hidden>,
      },
    }
  `);
});
