import { wait } from "@stackframe/stack-shared/dist/utils/promises";
import { it } from "../../../../helpers";
import { Auth, Project, Team, backendContext, bumpEmailAddress, niceBackendFetch } from "../../../backend-helpers";

const queryEvents = async (params: {
  userId?: string,
  eventType?: string,
}) => await niceBackendFetch("/api/v1/analytics/query", {
  method: "POST",
  accessType: "server",
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
  for (let attempt = 1; attempt < attempts; attempt++) {
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

  const fetchEvents = async () => await queryEvents({
    userId,
    eventType: "$session-activity",
  });

  let queryResponse = await fetchEvents();
  for (let attempt = 0; attempt < 3; attempt++) {
    if (queryResponse.status !== 200) {
      throw new Error(`Analytics query failed: ${JSON.stringify(queryResponse.body)}`);
    }
    const results = Array.isArray(queryResponse.body?.result) ? queryResponse.body.result : [];
    if (results.length > 0) {
      break;
    }
    await wait(500);
    queryResponse = await fetchEvents();
  }

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
  const projectA = await Project.createAndSwitch({ config: { magic_link_enabled: true } });
  const projectAKeys = backendContext.value.projectKeys;
  await Auth.Otp.signIn();

  // Switch to another project and generate its own event
  const projectB = await Project.createAndSwitch({ config: { magic_link_enabled: true } });
  const { userId: projectBUserId } = await Auth.Otp.signIn();
  const ensureProjectBEvent = async () => {
    let response = await queryEvents({
      userId: projectBUserId,
      eventType: "$session-activity",
    });
    for (let attempt = 0; attempt < 3 && Array.isArray(response.body?.result) && response.body.result.length === 0; attempt++) {
      await wait(250);
      response = await queryEvents({
        userId: projectBUserId,
        eventType: "$session-activity",
      });
    }
    expect(response.status).toBe(200);
    const results = Array.isArray(response.body?.result) ? response.body.result : [];
    expect(results.length).toBeGreaterThan(0);
  };
  await ensureProjectBEvent();

  // Switch back to project A context
  backendContext.set({ projectKeys: projectAKeys, userAuth: null });

  const queryResponse = await queryEvents({
    userId: projectBUserId,
    eventType: "$session-activity",
  });

  expect(queryResponse.status).toBe(200);
  const results = Array.isArray(queryResponse.body?.result) ? queryResponse.body.result : [];
  expect(results.length).toBe(0);
});

it("stores the team id for session events when a user selected a team", async ({ expect }) => {
  await Project.createAndSwitch({ config: { magic_link_enabled: true } });
  const { userId: userWithoutTeam } = await Auth.Otp.signIn();

  const userWithoutTeamResponse = await fetchEventsWithRetry({
    userId: userWithoutTeam,
    eventType: "$session-activity",
  });
  expect(userWithoutTeamResponse.status).toBe(200);
  const userWithoutTeamResults = Array.isArray(userWithoutTeamResponse.body?.result) ? userWithoutTeamResponse.body.result : [];
  expect(userWithoutTeamResults.length).toBeGreaterThan(0);
  expect(userWithoutTeamResults[0]).toMatchObject({
    user_id: userWithoutTeam,
    team_id: "",
  });

  await bumpEmailAddress();
  const { userId: userWithTeam } = await Auth.Otp.signIn();
  const { teamId } = await Team.createWithCurrentAsCreator({});
  const updateSelectedTeamResponse = await niceBackendFetch("/api/v1/users/me", {
    accessType: "client",
    method: "PATCH",
    body: {
      selected_team_id: teamId,
    },
  });
  expect(updateSelectedTeamResponse.status).toBe(200);
  expect(updateSelectedTeamResponse.body.selected_team_id).toBe(teamId);

  // Refresh the session to emit a new session activity event with the updated team
  await Auth.refreshAccessToken();

  const userWithTeamResponse = await fetchEventsWithRetry({
    userId: userWithTeam,
    eventType: "$session-activity",
  });
  expect(userWithTeamResponse.status).toBe(200);
  const userWithTeamResults = Array.isArray(userWithTeamResponse.body?.result) ? userWithTeamResponse.body.result : [];
  expect(userWithTeamResults.length).toBeGreaterThan(0);
  expect(userWithTeamResults[0]).toMatchObject({
    user_id: userWithTeam,
    team_id: teamId,
  });
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
