import { wait } from "@stackframe/stack-shared/dist/utils/promises";
import { it } from "../../../../helpers";
import { Auth, Project, backendContext, bumpEmailAddress, niceBackendFetch } from "../../../backend-helpers";

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
        ${params.userId ? "AND user_id = {user_id:String}" : ""}
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

const fetchEventsWithRetry = async (
  params: { userId?: string, eventType?: string },
  options: { attempts?: number, delayMs?: number } = {}
) => {
  const attempts = options.attempts ?? 5;
  const delayMs = options.delayMs ?? 250;

  let response = await queryEvents(params);
  for (let attempt = 0; attempt < attempts; attempt++) {
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
    eventType: "$session-activity",
  });

  expect(queryResponse.status).toBe(200);
  const results = Array.isArray(queryResponse.body?.result) ? queryResponse.body.result : [];
  expect(results.length).toBeGreaterThan(0);
  expect(results[0]).toMatchObject({
    event_type: "$session-activity",
    project_id: projectId,
    branch_id: "main",
    user_id: userId,
  });
});

it("cannot read events from other projects", async ({ expect }) => {
  await Project.createAndSwitch({ config: { magic_link_enabled: true } });
  const projectAKeys = backendContext.value.projectKeys;
  await Auth.Otp.signIn();

  // Switch to another project and generate its own event
  await Project.createAndSwitch({ config: { magic_link_enabled: true } });
  const { userId: projectBUserId } = await Auth.Otp.signIn();
  const projectBResponse = await fetchEventsWithRetry({
    userId: projectBUserId,
    eventType: "$session-activity",
  });
  expect(projectBResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "result": [
          {
            "branch_id": "main",
            "event_type": "$session-activity",
            "project_id": "<stripped UUID>",
            "team_id": "",
            "user_id": "<stripped UUID>",
          },
        ],
        "stats": {
          "cpu_time": <stripped field 'cpu_time'>,
          "wall_clock_time": <stripped field 'wall_clock_time'>,
        },
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);


  // Switch back to project A context
  backendContext.set({ projectKeys: projectAKeys, userAuth: null });

  const queryResponse = await queryEvents({
    userId: projectBUserId,
    eventType: "$session-activity",
  });
  expect(queryResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "result": [],
        "stats": {
          "cpu_time": <stripped field 'cpu_time'>,
          "wall_clock_time": <stripped field 'wall_clock_time'>,
        },
      },
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
    eventType: "$session-activity",
  });
  expect(userAResponse.status).toBe(200);
  const userAResults = Array.isArray(userAResponse.body?.result) ? userAResponse.body.result : [];
  expect(userAResults.length).toBeGreaterThan(0);
  expect(userAResults.every((row: any) => row.user_id === userA)).toBe(true);

  const userBResponse = await fetchEventsWithRetry({
    userId: userB,
    eventType: "$session-activity",
  });
  expect(userBResponse.status).toBe(200);
  const userBResults = Array.isArray(userBResponse.body?.result) ? userBResponse.body.result : [];
  expect(userBResults.length).toBeGreaterThan(0);
  expect(userBResults.every((row: any) => row.user_id === userB)).toBe(true);
});
