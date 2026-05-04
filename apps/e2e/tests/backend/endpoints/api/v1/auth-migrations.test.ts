import { it } from "../../../../helpers";
import { Project, niceBackendFetch } from "../../../backend-helpers";

it("creates and reads queued auth migration jobs from the backend", async ({ expect }) => {
  await Project.createAndSwitch();

  const createResponse = await niceBackendFetch("/api/v1/internal/auth-migrations", {
    method: "POST",
    accessType: "admin",
    body: {
      provider: "clerk",
      credentials: {
        secret_key: "sk_test_dummy",
      },
    },
  });

  expect(createResponse).toMatchObject({
    status: 200,
    body: {
      id: expect.any(String),
      provider: "clerk",
      status: "PENDING",
      attempt_count: 0,
      max_attempts: 5,
      next_attempt_at_millis: null,
      started_at_millis: null,
      finished_at_millis: null,
      last_error_external_message: null,
    },
  });

  const jobId = createResponse.body.id as string;

  const readResponse = await niceBackendFetch(`/api/v1/internal/auth-migrations/${jobId}`, {
    accessType: "admin",
  });
  expect(readResponse).toMatchObject({
    status: 200,
    body: {
      id: jobId,
      provider: "clerk",
      status: "PENDING",
    },
  });

  const listResponse = await niceBackendFetch("/api/v1/internal/auth-migrations", {
    accessType: "admin",
  });
  expect(listResponse).toMatchObject({
    status: 200,
    body: {
      items: expect.arrayContaining([
        expect.objectContaining({
          id: jobId,
          provider: "clerk",
          status: "PENDING",
        }),
      ]),
    },
  });
});
