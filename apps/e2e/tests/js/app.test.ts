import { isUuid } from "@stackframe/stack-shared/dist/utils/uuids";
import { wait } from "@stackframe/stack-shared/dist/utils/promises";
import { tokenStoreFromHeaders } from "@stackframe/js";
import { it } from "../helpers";
import { niceBackendFetch } from "../backend/backend-helpers";
import { createApp, scaffoldProject } from "./js-helpers";

async function queryAnalyticsByEventTypeWithRetry(
  adminApp: Awaited<ReturnType<typeof createApp>>["adminApp"],
  eventType: string,
) {
  let response = await adminApp.queryAnalytics({
    query: `
      SELECT event_type, user_id, team_id, browser_session_id, session_replay_id, session_replay_segment_id
      FROM events
      WHERE event_type = {event_type:String}
      ORDER BY event_at DESC
      LIMIT 5
    `,
    params: { event_type: eventType },
  });

  for (let attempt = 0; attempt < 15; attempt++) {
    if (response.result.length > 0) {
      return response;
    }
    await wait(500);
    response = await adminApp.queryAnalytics({
      query: `
        SELECT event_type, user_id, team_id, browser_session_id, session_replay_id, session_replay_segment_id
        FROM events
        WHERE event_type = {event_type:String}
        ORDER BY event_at DESC
        LIMIT 5
      `,
      params: { event_type: eventType },
    });
  }

  return response;
}

async function enableAnalyticsApp(adminApp: Awaited<ReturnType<typeof createApp>>["adminApp"]) {
  const project = await adminApp.getProject();
  await project.updateConfig({
    "apps.installed.analytics.enabled": true,
  });
}

async function uploadSessionReplayBatch(options: {
  projectId: string,
  publishableClientKey: string,
  accessToken?: string,
  refreshToken?: string,
  browserSessionId: string,
  sessionReplaySegmentId: string,
  nowMs: number,
}) {
  return await niceBackendFetch("/api/v1/session-replays/batch", {
    method: "POST",
    accessType: "client",
    userAuth: {
      accessToken: options.accessToken,
      refreshToken: options.refreshToken,
    },
    headers: {
      "x-stack-project-id": options.projectId,
      "x-stack-publishable-client-key": options.publishableClientKey,
    },
    body: {
      browser_session_id: options.browserSessionId,
      session_replay_segment_id: options.sessionReplaySegmentId,
      batch_id: crypto.randomUUID(),
      started_at_ms: options.nowMs - 200,
      sent_at_ms: options.nowMs - 100,
      events: [{ timestamp: options.nowMs - 150 }],
    },
  });
}


it("should scaffold the project", async ({ expect }) => {
  const { project } = await scaffoldProject();
  expect(project.displayName).toBe("New Project");
});

it("should sign up with credential", async ({ expect }) => {
  const { clientApp } = await createApp();
  const result1 = await clientApp.signUpWithCredential({
    email: "test@test.com",
    password: "password",
    verificationCallbackUrl: "http://localhost:3000",
  });

  expect(result1).toMatchInlineSnapshot(`
    {
      "data": undefined,
      "status": "ok",
    }
  `);

  const result2 = await clientApp.signInWithCredential({
    email: "test@test.com",
    password: "password",
  });

  expect(result2).toMatchInlineSnapshot(`
    {
      "data": undefined,
      "status": "ok",
    }
  `);
});

it("should sign up without a verification callback when disabled", async ({ expect }) => {
  const { clientApp } = await createApp();
  const signUpResult = await clientApp.signUpWithCredential({
    email: "no-verification@test.com",
    password: "password",
    noVerificationCallback: true,
  });

  expect(signUpResult).toMatchInlineSnapshot(`
    {
      "data": undefined,
      "status": "ok",
    }
  `);

  const signInResult = await clientApp.signInWithCredential({
    email: "no-verification@test.com",
    password: "password",
  });

  expect(signInResult).toMatchInlineSnapshot(`
    {
      "data": undefined,
      "status": "ok",
    }
  `);
});

it("should throw when disabling verification with a callback url provided", async ({ expect }) => {
  const { clientApp } = await createApp();

  await expect(clientApp.signUpWithCredential({
    email: "no-verification-conflict@test.com",
    password: "password",
    noVerificationCallback: true,
    // @ts-expect-error - testing the error case
    verificationCallbackUrl: "http://localhost:3000",
  })).rejects.toMatchObject({
    message: expect.stringContaining("verificationCallbackUrl is not allowed when noVerificationCallback is true"),
    name: "StackAssertionError",
  });
});

it("should create user on the server", async ({ expect }) => {
  const { serverApp } = await createApp();
  const user = await serverApp.createUser({
    primaryEmail: "test@test.com",
    password: "password",
    primaryEmailAuthEnabled: true,
  });

  expect(isUuid(user.id)).toBe(true);

  const user2 = await serverApp.getUser(user.id);
  expect(user2?.id).toBe(user.id);

  const result = await serverApp.signInWithCredential({
    email: "test@test.com",
    password: "password",
  });

  expect(result).toMatchInlineSnapshot(`
    {
      "data": undefined,
      "status": "ok",
    }
  `);
});

it("should create user on the server with country code and risk scores", async ({ expect }) => {
  const { serverApp } = await createApp();
  const user = await serverApp.createUser({
    primaryEmail: "imported-risk@test.com",
    primaryEmailAuthEnabled: true,
    countryCode: "US",
    riskScores: {
      signUp: {
        bot: 61,
        freeTrialAbuse: 27,
      },
    },
  });

  expect(user.countryCode).toBe("US");
  expect(user.riskScores).toEqual({
    signUp: {
      bot: 61,
      freeTrialAbuse: 27,
    },
  });
});

it("should track custom analytics events from the client app", async ({ expect }) => {
  const { clientApp, adminApp } = await createApp();
  await enableAnalyticsApp(adminApp);

  const email = `${crypto.randomUUID()}@client-track.test`;
  const password = "password";
  const signUpResult = await clientApp.signUpWithCredential({
    email,
    password,
    verificationCallbackUrl: "http://localhost:3000",
  });
  expect(signUpResult.status).toBe("ok");

  const signInResult = await clientApp.signInWithCredential({ email, password });
  expect(signInResult.status).toBe("ok");

  const user = await clientApp.getUser({ or: "throw" });
  const eventType = `checkout.completed.${crypto.randomUUID()}`;

  await clientApp.trackEvent(eventType, {
    amount: 4200,
    currency: "usd",
  });

  const response = await queryAnalyticsByEventTypeWithRetry(adminApp, eventType);
  expect(response.result[0]).toMatchObject({
    event_type: eventType,
    user_id: user.id,
    team_id: null,
  });
});

it("should allow explicit session replay linkage from the client app", async ({ expect }) => {
  const { clientApp, adminApp, apiKey, project } = await createApp();
  await enableAnalyticsApp(adminApp);
  const publishableClientKey = apiKey.publishableClientKey;
  if (publishableClientKey == null) {
    throw new Error("Expected createApp() to return a publishableClientKey.");
  }

  const email = `${crypto.randomUUID()}@client-track-replay.test`;
  const password = "password";
  expect((await clientApp.signUpWithCredential({
    email,
    password,
    verificationCallbackUrl: "http://localhost:3000",
  })).status).toBe("ok");
  expect((await clientApp.signInWithCredential({ email, password })).status).toBe("ok");

  const authJson = await clientApp.getAuthJson() as {
    accessToken?: string,
    refreshToken?: string,
  };
  const browserSessionId = crypto.randomUUID();
  const sessionReplaySegmentId = crypto.randomUUID();
  const now = Date.now();
  const replayUploadRes = await uploadSessionReplayBatch({
    projectId: project.id,
    publishableClientKey,
    accessToken: authJson.accessToken,
    refreshToken: authJson.refreshToken,
    browserSessionId,
    sessionReplaySegmentId,
    nowMs: now,
  });
  expect(replayUploadRes.status).toBe(200);

  const sessionReplayId = replayUploadRes.body?.session_replay_id;
  expect(typeof sessionReplayId).toBe("string");
  if (typeof sessionReplayId !== "string") {
    throw new Error("Expected session replay upload response to include a session_replay_id.");
  }

  const eventType = `checkout.explicit-replay.${crypto.randomUUID()}`;
  await clientApp.trackEvent(eventType, {
    amount: 4200,
    currency: "usd",
  }, {
    sessionReplayId,
    sessionReplaySegmentId,
  });

  const response = await queryAnalyticsByEventTypeWithRetry(adminApp, eventType);
  expect(response.result[0]).toMatchObject({
    event_type: eventType,
    browser_session_id: browserSessionId,
    session_replay_id: sessionReplayId,
    session_replay_segment_id: sessionReplaySegmentId,
  });
});

it("should track project-scoped and request-bound custom analytics events from the server app", async ({ expect }) => {
  const { clientApp, serverApp, adminApp, apiKey, project } = await createApp();
  await enableAnalyticsApp(adminApp);
  const publishableClientKey = apiKey.publishableClientKey;
  if (publishableClientKey == null) {
    throw new Error("Expected createApp() to return a publishableClientKey.");
  }

  const email = `${crypto.randomUUID()}@server-track.test`;
  const password = "password";
  const signUpResult = await clientApp.signUpWithCredential({
    email,
    password,
    verificationCallbackUrl: "http://localhost:3000",
  });
  expect(signUpResult.status).toBe("ok");
  expect((await clientApp.signInWithCredential({ email, password })).status).toBe("ok");

  const user = await clientApp.getUser({ or: "throw" });
  const requestHeaders = await clientApp.getAuthHeaders();
  const requestTokenStore = tokenStoreFromHeaders({
    "x-stack-auth": requestHeaders["x-stack-auth"],
  });

  const requestBoundEventType = `request.bound.${crypto.randomUUID()}`;
  await serverApp.trackEvent(requestBoundEventType, {
    source: "express",
  }, {
    tokenStore: requestTokenStore,
  });

  const honoStyleEventType = `request.bound.raw-request.${crypto.randomUUID()}`;
  await serverApp.trackEvent(honoStyleEventType, {
    source: "hono",
  }, {
    tokenStore: new Request("https://example.test/api/events", {
      headers: {
        "x-stack-auth": requestHeaders["x-stack-auth"],
      },
    }),
  });

  const projectScopedEventType = `project.scoped.${crypto.randomUUID()}`;
  await serverApp.trackEvent(projectScopedEventType, {
    source: "cron",
  });

  const authJson = await clientApp.getAuthJson() as {
    accessToken?: string,
    refreshToken?: string,
  };
  const explicitBrowserSessionId = crypto.randomUUID();
  const explicitSessionReplaySegmentId = crypto.randomUUID();
  const replayUploadRes = await uploadSessionReplayBatch({
    projectId: project.id,
    publishableClientKey,
    accessToken: authJson.accessToken,
    refreshToken: authJson.refreshToken,
    browserSessionId: explicitBrowserSessionId,
    sessionReplaySegmentId: explicitSessionReplaySegmentId,
    nowMs: Date.now(),
  });
  expect(replayUploadRes.status).toBe(200);

  const explicitSessionReplayId = replayUploadRes.body?.session_replay_id;
  expect(typeof explicitSessionReplayId).toBe("string");
  if (typeof explicitSessionReplayId !== "string") {
    throw new Error("Expected session replay upload response to include a session_replay_id.");
  }

  const explicitLinkedEventType = `project.scoped.explicit-replay.${crypto.randomUUID()}`;
  await serverApp.trackEvent(explicitLinkedEventType, {
    source: "cron",
  }, {
    sessionReplayId: explicitSessionReplayId,
    sessionReplaySegmentId: explicitSessionReplaySegmentId,
  });

  const requestBoundResponse = await queryAnalyticsByEventTypeWithRetry(adminApp, requestBoundEventType);
  expect(requestBoundResponse.result[0]).toMatchObject({
    event_type: requestBoundEventType,
    user_id: user.id,
  });

  const honoStyleResponse = await queryAnalyticsByEventTypeWithRetry(adminApp, honoStyleEventType);
  expect(honoStyleResponse.result[0]).toMatchObject({
    event_type: honoStyleEventType,
    user_id: user.id,
  });

  const projectScopedResponse = await queryAnalyticsByEventTypeWithRetry(adminApp, projectScopedEventType);
  expect(projectScopedResponse.result[0]).toMatchObject({
    event_type: projectScopedEventType,
    user_id: null,
    team_id: null,
  });

  const explicitLinkedResponse = await queryAnalyticsByEventTypeWithRetry(adminApp, explicitLinkedEventType);
  expect(explicitLinkedResponse.result[0]).toMatchObject({
    event_type: explicitLinkedEventType,
    browser_session_id: explicitBrowserSessionId,
    session_replay_id: explicitSessionReplayId,
    session_replay_segment_id: explicitSessionReplaySegmentId,
  });
});

it("should throw a helpful error when destructuring user", async ({ expect }) => {
  const { clientApp, serverApp } = await createApp();

  const email = "user-destructure@test.com";
  const password = "password";

  const signUpResult = await clientApp.signUpWithCredential({
    email,
    password,
    verificationCallbackUrl: "http://localhost:3000",
  });
  expect(signUpResult.status).toBe("ok");

  const signInResult = await clientApp.signInWithCredential({
    email,
    password,
  });
  expect(signInResult.status).toBe("ok");

  const currentUser = await clientApp.getUser({ or: "throw" });
  const accessClientUser = () => (currentUser as any).user;
  expect(accessClientUser).toThrowError("Stack Auth: useUser() already returns the user object. Use `const user = useUser()` (or `const user = await app.getUser()`) instead of destructuring it like `const { user } = ...`.");

  const serverUser = await serverApp.getUser(currentUser.id);
  if (!serverUser) {
    throw new Error("Expected server user to exist for destructure guard test");
  }
  const accessServerUser = () => (serverUser as any).user;
  expect(accessServerUser).toThrowError("Stack Auth: useUser() already returns the user object. Use `const user = useUser()` (or `const user = await app.getUser()`) instead of destructuring it like `const { user } = ...`.");
});
