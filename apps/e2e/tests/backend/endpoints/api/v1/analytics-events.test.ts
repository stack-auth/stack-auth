import { wait } from "@stackframe/stack-shared/dist/utils/promises";
import { it } from "../../../../helpers";
import { Auth, Project, backendContext, bumpEmailAddress, niceBackendFetch } from "../../../backend-helpers";

type ExpectLike = ((value: unknown) => { toEqual: (value: unknown) => void }) & {
  any: (constructor: unknown) => unknown,
};

const stripQueryId = <T extends { status: number, body?: Record<string, unknown> | null }>(response: T, expect: ExpectLike) => {
  if (response.status === 200 && response.body) {
    expect(response.body.query_id).toEqual(expect.any(String));
    delete response.body.query_id;
  }
  return response;
};

const queryEvents = async (params: {
  userId?: string,
  eventType?: string,
}) => await niceBackendFetch("/api/v1/internal/analytics/query", {
  method: "POST",
  accessType: "admin",
  body: {
    query: `
      SELECT event_type, project_id, branch_id, user_id, team_id
      FROM events
      WHERE 1
        ${params.userId ? "AND user_id = {user_id:Nullable(String)}" : ""}
        ${params.eventType ? "AND event_type = {event_type:String}" : ""}
      ORDER BY event_at DESC
      LIMIT 10
    `,
    params: {
      ...(params.userId ? { user_id: params.userId } : {}),
      ...(params.eventType ? { event_type: params.eventType } : {}),
    },
  },
});

const queryEventDataJson = async (params: {
  userId?: string,
  eventType?: string,
}) => await niceBackendFetch("/api/v1/internal/analytics/query", {
  method: "POST",
  accessType: "admin",
  body: {
    query: `
      SELECT toJSONString(data) AS data_json
      FROM events
      WHERE 1
        ${params.userId ? "AND user_id = {user_id:Nullable(String)}" : ""}
        ${params.eventType ? "AND event_type = {event_type:String}" : ""}
      ORDER BY event_at DESC
      LIMIT 1
    `,
    params: {
      ...(params.userId ? { user_id: params.userId } : {}),
      ...(params.eventType ? { event_type: params.eventType } : {}),
    },
  },
});

// The events under test are produced *asynchronously* by the sign-in path:
// `runAsynchronouslyAndWaitUntil(logEvent)` fires after the HTTP response
// returns and runs through SDK self-call → quota debit → Postgres insert →
// ClickHouse async_insert (which is server-buffered, no wait_for_async_insert).
// Under CI load this whole pipeline can take well over 10s before the row
// becomes queryable. We use a 30s time-based timeout (via performance.now())
// which is conservative; the loop breaks out as soon as the row appears.
const DEFAULT_QUERY_TIMEOUT_MS = 30_000;
const DEFAULT_QUERY_RETRY_DELAY_MS = 500;

const fetchEventDataJsonWithRetry = async (
  params: { userId?: string, eventType?: string },
  options: { timeoutMs?: number, delayMs?: number } = {}
) => {
  const timeoutMs = options.timeoutMs ?? DEFAULT_QUERY_TIMEOUT_MS;
  const delayMs = options.delayMs ?? DEFAULT_QUERY_RETRY_DELAY_MS;
  const startedAt = performance.now();

  let response = await queryEventDataJson(params);
  while (performance.now() - startedAt < timeoutMs) {
    if (response.status !== 200) {
      break;
    }
    const results = Array.isArray(response.body?.result) ? response.body.result : [];
    if (results.length > 0) {
      break;
    }
    await wait(delayMs);
    response = await queryEventDataJson(params);
  }

  return response;
};

const fetchEventsWithRetry = async (
  params: { userId?: string, eventType?: string },
  options: { timeoutMs?: number, delayMs?: number } = {}
) => {
  const timeoutMs = options.timeoutMs ?? DEFAULT_QUERY_TIMEOUT_MS;
  const delayMs = options.delayMs ?? DEFAULT_QUERY_RETRY_DELAY_MS;
  const startedAt = performance.now();

  let response = await queryEvents(params);
  while (performance.now() - startedAt < timeoutMs) {
    if (response.status !== 200) {
      break;
    }
    const results = Array.isArray(response.body?.result) ? response.body.result : [];
    if (results.length > 0) {
      break;
    }
    await wait(delayMs);
    response = await queryEvents(params);
  }

  return response;
};


it("stores backend events in ClickHouse", async ({ expect }) => {
  const { projectId } = await Project.createAndSwitch({ config: { magic_link_enabled: true } });
  const { userId } = await Auth.Otp.signIn();

  const queryResponse = await fetchEventsWithRetry({
    userId,
    eventType: "$token-refresh",
  });

  expect(queryResponse.status).toBe(200);
  const results = Array.isArray(queryResponse.body?.result) ? queryResponse.body.result : [];
  expect(results.length).toBeGreaterThan(0);
  expect(results[0]).toMatchObject({
    event_type: "$token-refresh",
    project_id: projectId,
    branch_id: "main",
    user_id: userId,
    team_id: null,
  });
});

it("stores $token-refresh data in snake_case without row identity fields", async ({ expect }) => {
  await Project.createAndSwitch({ config: { magic_link_enabled: true } });
  const { userId } = await Auth.Otp.signIn();

  const queryResponse = await fetchEventDataJsonWithRetry({
    userId,
    eventType: "$token-refresh",
  });

  expect(queryResponse.status).toBe(200);
  const results = Array.isArray(queryResponse.body?.result) ? queryResponse.body.result : [];
  expect(results.length).toBeGreaterThan(0);

  const dataJson = results[0]?.data_json;
  if (typeof dataJson !== "string") {
    throw new Error("Expected ClickHouse $token-refresh row to include data_json as a string.");
  }
  const data = JSON.parse(dataJson) as Record<string, unknown>;

  expect(data).toMatchInlineSnapshot(`
    {
      "is_anonymous": false,
      "refresh_token_id": <stripped field 'refresh_token_id'>,
    }
  `);
});

it("cannot read events from other projects", async ({ expect }) => {
  await Project.createAndSwitch({ config: { magic_link_enabled: true } });
  const projectAKeys = backendContext.value.projectKeys;
  await Auth.fastSignUp();

  // Switch to another project and generate its own event
  await Project.createAndSwitch({ config: { magic_link_enabled: true } });
  const { userId: projectBUserId } = await Auth.fastSignUp();
  const projectBResponse = await fetchEventsWithRetry({
    userId: projectBUserId,
    eventType: "$token-refresh",
  });
  expect(stripQueryId(projectBResponse, expect)).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "result": [
          {
            "branch_id": "main",
            "event_type": "$token-refresh",
            "project_id": "<stripped UUID>",
            "team_id": null,
            "user_id": "<stripped UUID>",
          },
        ],
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);


  // Switch back to project A context
  backendContext.set({ projectKeys: projectAKeys, userAuth: null });

  const queryResponse = await queryEvents({
    userId: projectBUserId,
    eventType: "$token-refresh",
  });
  expect(stripQueryId(queryResponse, expect)).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": { "result": [] },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("filters analytics events by user within a project", async ({ expect }) => {
  await Project.createAndSwitch({ config: { magic_link_enabled: true } });
  const { userId: userA } = await Auth.Otp.signIn();
  await bumpEmailAddress();
  const { userId: userB } = await Auth.Otp.signIn();

  const userAResponse = await fetchEventsWithRetry({
    userId: userA,
    eventType: "$token-refresh",
  });
  expect(userAResponse.status).toBe(200);
  const userAResults = Array.isArray(userAResponse.body?.result) ? userAResponse.body.result : [];
  expect(userAResults.length).toBeGreaterThan(0);
  expect(userAResults.every((row: any) => row.user_id === userA)).toBe(true);

  const userBResponse = await fetchEventsWithRetry({
    userId: userB,
    eventType: "$token-refresh",
  });
  expect(userBResponse.status).toBe(200);
  const userBResults = Array.isArray(userBResponse.body?.result) ? userBResponse.body.result : [];
  expect(userBResults.length).toBeGreaterThan(0);
  expect(userBResults.every((row: any) => row.user_id === userB)).toBe(true);
});
