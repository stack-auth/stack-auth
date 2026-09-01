import {
  TvDisplayPairingChallengeSchema,
  TvDisplayPairingStatusSchema,
  TvSnapshotSchema,
} from "@hexclave/shared/dist/interface/admin-tv-mode";
import { it, niceFetch, STACK_BACKEND_BASE_URL, updateCookiesFromResponse } from "../../../../helpers";
import { Project } from "../../../backend-helpers";

function apiUrl(path: string): URL {
  return new URL(`/api/latest${path}`, STACK_BACKEND_BASE_URL);
}

async function publicJsonRequest(path: string, options: {
  method?: "GET" | "POST",
  body?: unknown,
  authorization?: string,
  cookie?: string,
}) {
  return await niceFetch(apiUrl(path), {
    method: options.method ?? "GET",
    headers: {
      ...options.body === undefined ? {} : { "content-type": "application/json" },
      ...options.authorization == null ? {} : { authorization: `Bearer ${options.authorization}` },
      ...options.cookie == null ? {} : { cookie: options.cookie },
    },
    ...options.body === undefined ? {} : { body: JSON.stringify(options.body) },
  });
}

async function adminJsonRequest(options: {
  path: string,
  projectId: string,
  adminAccessToken: string,
  method?: "GET" | "POST" | "PATCH" | "DELETE",
  body?: unknown,
}) {
  return await niceFetch(apiUrl(options.path), {
    method: options.method ?? "GET",
    headers: {
      "x-stack-access-type": "admin",
      "x-stack-project-id": options.projectId,
      "x-stack-branch-id": "main",
      "x-stack-admin-access-token": options.adminAccessToken,
      ...options.body === undefined ? {} : { "content-type": "application/json" },
    },
    ...options.body === undefined ? {} : { body: JSON.stringify(options.body) },
  });
}

it("pairs a narrow display principal, preserves tenancy assignment, and detects refresh replay", async ({ expect }) => {
  const firstProject = await Project.createAndSwitch();
  const challengeResponse = await publicJsonRequest("/tv-displays/pairing-challenges", { method: "POST" });
  expect(challengeResponse.status).toBe(200);
  const challenge = await TvDisplayPairingChallengeSchema.validate(challengeResponse.body, { strict: true });

  const approvalResponse = await adminJsonRequest({
    path: "/internal/tv-mode/displays",
    projectId: firstProject.projectId,
    adminAccessToken: firstProject.adminAccessToken,
    method: "POST",
    body: {
      pairingCode: challenge.pairingCode,
      profileId: "company-pulse",
      displayName: "E2E Lobby Display",
      acknowledgeExactFinancials: false,
    },
  });
  expect(approvalResponse.status).toBe(200);
  expect(approvalResponse.body).toMatchObject({
    success: true,
    approvedAt: expect.any(String),
    expiresAt: challenge.expiresAt,
  });

  const statusResponse = await publicJsonRequest(
    `/tv-displays/pairing-challenges/${encodeURIComponent(challenge.challengeId)}/status`,
    { method: "POST", body: { deviceSecret: challenge.deviceSecret } },
  );
  expect(statusResponse.status).toBe(200);
  const pairing = await TvDisplayPairingStatusSchema.validate(statusResponse.body, { strict: true });
  if (pairing.status !== "paired") throw new Error(`Expected paired display, received ${pairing.status}.`);
  const firstRefreshCookie = updateCookiesFromResponse("", statusResponse);
  const refreshSetCookies = statusResponse.headers.getSetCookie()
    .filter((cookie) => cookie.startsWith("hexclave-tv-display-refresh="));
  expect(refreshSetCookies).toHaveLength(3);
  expect(refreshSetCookies).toEqual(expect.arrayContaining([
    expect.stringContaining("Path=/api; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=0"),
    expect.stringContaining("Path=/api/latest/tv-displays"),
    expect.stringContaining("Path=/api/v1/tv-displays"),
  ]));
  for (const refreshSetCookie of refreshSetCookies) {
    expect(refreshSetCookie).toContain("HttpOnly");
    expect(refreshSetCookie).toContain("SameSite=Strict");
  }
  for (const refreshSetCookie of refreshSetCookies.filter((cookie) => !cookie.includes("Max-Age=0"))) {
    expect(refreshSetCookie).toContain("Max-Age=2592000");
  }

  const snapshotResponse = await publicJsonRequest(
    "/tv-displays/snapshot?projectId=not-trusted&profileId=engineering-office",
    { authorization: pairing.accessToken },
  );
  expect(snapshotResponse.status).toBe(200);
  const snapshot = await TvSnapshotSchema.validate(snapshotResponse.body, { strict: true });
  expect(snapshot.project.id).toBe(firstProject.projectId);
  expect(snapshot.profile.id).toBe("company-pulse");

  const adminBoundaryResponse = await publicJsonRequest("/internal/tv-mode/profiles", {
    authorization: pairing.accessToken,
  });
  expect(adminBoundaryResponse.status).toBe(400);

  const secondProject = await Project.createAndSwitch();
  const crossTenantUpdate = await adminJsonRequest({
    path: `/internal/tv-mode/displays/${encodeURIComponent(pairing.display.id)}`,
    projectId: secondProject.projectId,
    adminAccessToken: secondProject.adminAccessToken,
    method: "PATCH",
    body: {
      profileId: "company-pulse",
      displayName: "Wrong Tenant",
      acknowledgeExactFinancials: false,
    },
  });
  expect(crossTenantUpdate.status).toBe(404);

  const crossTenantDelete = await adminJsonRequest({
    path: `/internal/tv-mode/displays/${encodeURIComponent(pairing.display.id)}`,
    projectId: secondProject.projectId,
    adminAccessToken: secondProject.adminAccessToken,
    method: "DELETE",
  });
  expect(crossTenantDelete.status).toBe(404);

  const secondProjectDisplays = await adminJsonRequest({
    path: "/internal/tv-mode/displays",
    projectId: secondProject.projectId,
    adminAccessToken: secondProject.adminAccessToken,
  });
  expect(secondProjectDisplays.status).toBe(200);
  expect(secondProjectDisplays.body).toEqual({ displays: [] });

  const refreshResponse = await publicJsonRequest("/tv-displays/auth/refresh", {
    method: "POST",
    cookie: firstRefreshCookie,
  });
  expect(refreshResponse.status).toBe(200);
  expect(refreshResponse.body).toMatchObject({ accessToken: expect.any(String) });

  const replayResponse = await publicJsonRequest("/tv-displays/auth/refresh", {
    method: "POST",
    cookie: firstRefreshCookie,
  });
  expect(replayResponse.status).toBe(401);

  const compromisedFamilySnapshot = await publicJsonRequest("/tv-displays/snapshot", {
    authorization: refreshResponse.body.accessToken,
  });
  expect(compromisedFamilySnapshot.status).toBe(401);
});

it("hard-deletes a display after an administrator unpairs it and rejects its remote credentials", async ({ expect }) => {
  const project = await Project.createAndSwitch();
  const challengeResponse = await publicJsonRequest("/tv-displays/pairing-challenges", { method: "POST" });
  expect(challengeResponse.status).toBe(200);
  const challenge = await TvDisplayPairingChallengeSchema.validate(challengeResponse.body, { strict: true });

  const approvalResponse = await adminJsonRequest({
    path: "/internal/tv-mode/displays",
    projectId: project.projectId,
    adminAccessToken: project.adminAccessToken,
    method: "POST",
    body: {
      pairingCode: challenge.pairingCode,
      profileId: "company-pulse",
      displayName: "E2E Active Display",
      acknowledgeExactFinancials: false,
    },
  });
  expect(approvalResponse.status).toBe(200);

  const statusResponse = await publicJsonRequest(
    `/tv-displays/pairing-challenges/${encodeURIComponent(challenge.challengeId)}/status`,
    { method: "POST", body: { deviceSecret: challenge.deviceSecret } },
  );
  expect(statusResponse.status).toBe(200);
  const pairing = await TvDisplayPairingStatusSchema.validate(statusResponse.body, { strict: true });
  if (pairing.status !== "paired") throw new Error(`Expected paired display, received ${pairing.status}.`);
  const refreshCookie = updateCookiesFromResponse("", statusResponse);

  const activeDisplays = await adminJsonRequest({
    path: "/internal/tv-mode/displays",
    projectId: project.projectId,
    adminAccessToken: project.adminAccessToken,
  });
  expect(activeDisplays.status).toBe(200);
  expect(activeDisplays.body).toMatchObject({
    displays: [expect.objectContaining({ id: pairing.display.id, state: "never-connected" })],
  });

  const unpairResponse = await adminJsonRequest({
    path: `/internal/tv-mode/displays/${encodeURIComponent(pairing.display.id)}`,
    projectId: project.projectId,
    adminAccessToken: project.adminAccessToken,
    method: "DELETE",
  });
  expect(unpairResponse.status).toBe(200);

  const remainingDisplays = await adminJsonRequest({
    path: "/internal/tv-mode/displays",
    projectId: project.projectId,
    adminAccessToken: project.adminAccessToken,
  });
  expect(remainingDisplays.status).toBe(200);
  expect(remainingDisplays.body).toEqual({ displays: [] });

  const staleSnapshot = await publicJsonRequest("/tv-displays/snapshot", {
    authorization: pairing.accessToken,
  });
  expect(staleSnapshot.status).toBe(401);
  const staleRefresh = await publicJsonRequest("/tv-displays/auth/refresh", {
    method: "POST",
    cookie: refreshCookie,
  });
  expect(staleRefresh.status).toBe(401);

  const repeatedUnpair = await publicJsonRequest("/tv-displays/unpair", {
    method: "POST",
    authorization: pairing.accessToken,
    cookie: refreshCookie,
  });
  expect(repeatedUnpair.status).toBe(401);
});

it("clears every refresh-cookie path when a display unpairs itself", async ({ expect }) => {
  const project = await Project.createAndSwitch();
  const challengeResponse = await publicJsonRequest("/tv-displays/pairing-challenges", { method: "POST" });
  expect(challengeResponse.status).toBe(200);
  const challenge = await TvDisplayPairingChallengeSchema.validate(challengeResponse.body, { strict: true });
  const approvalResponse = await adminJsonRequest({
    path: "/internal/tv-mode/displays",
    projectId: project.projectId,
    adminAccessToken: project.adminAccessToken,
    method: "POST",
    body: {
      pairingCode: challenge.pairingCode,
      profileId: "company-pulse",
      displayName: "Self Unpair Display",
      acknowledgeExactFinancials: false,
    },
  });
  expect(approvalResponse.status).toBe(200);
  const statusResponse = await publicJsonRequest(
    `/tv-displays/pairing-challenges/${encodeURIComponent(challenge.challengeId)}/status`,
    { method: "POST", body: { deviceSecret: challenge.deviceSecret } },
  );
  const pairing = await TvDisplayPairingStatusSchema.validate(statusResponse.body, { strict: true });
  if (pairing.status !== "paired") throw new Error(`Expected paired display, received ${pairing.status}.`);
  const refreshCookie = updateCookiesFromResponse("", statusResponse);

  const unpairResponse = await publicJsonRequest("/tv-displays/unpair", {
    method: "POST",
    authorization: pairing.accessToken,
    cookie: refreshCookie,
  });
  expect(unpairResponse.status).toBe(200);
  expect(unpairResponse.body).toEqual({ success: true });
  const clearedCookies = unpairResponse.headers.getSetCookie()
    .filter((cookie) => cookie.startsWith("hexclave-tv-display-refresh="));
  expect(clearedCookies).toHaveLength(3);
  expect(clearedCookies).toEqual(expect.arrayContaining([
    expect.stringContaining("Path=/api/latest/tv-displays"),
    expect.stringContaining("Path=/api/v1/tv-displays"),
    expect.stringContaining("Path=/api;"),
  ]));
  for (const clearedCookie of clearedCookies) expect(clearedCookie).toContain("Max-Age=0");

  const staleRefresh = await publicJsonRequest("/tv-displays/auth/refresh", {
    method: "POST",
    cookie: refreshCookie,
  });
  expect(staleRefresh.status).toBe(401);
});
