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

  const statusResponse = await publicJsonRequest(
    `/tv-displays/pairing-challenges/${encodeURIComponent(challenge.challengeId)}/status`,
    { method: "POST", body: { deviceSecret: challenge.deviceSecret } },
  );
  expect(statusResponse.status).toBe(200);
  const pairing = await TvDisplayPairingStatusSchema.validate(statusResponse.body, { strict: true });
  if (pairing.status !== "paired") throw new Error(`Expected paired display, received ${pairing.status}.`);
  const firstRefreshCookie = updateCookiesFromResponse("", statusResponse);
  expect(statusResponse.headers.getSetCookie().join(";")).toContain("HttpOnly");
  expect(statusResponse.headers.getSetCookie().join(";")).toContain("SameSite=Strict");

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
  expect(adminBoundaryResponse.status).not.toBe(200);

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

it("lists only active displays after an administrator unpairs one", async ({ expect }) => {
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

  const activeDisplays = await adminJsonRequest({
    path: "/internal/tv-mode/displays",
    projectId: project.projectId,
    adminAccessToken: project.adminAccessToken,
  });
  expect(activeDisplays.status).toBe(200);
  expect(activeDisplays.body).toMatchObject({
    displays: [expect.objectContaining({ id: pairing.display.id, state: "never-connected" })],
  });

  const revokeResponse = await adminJsonRequest({
    path: `/internal/tv-mode/displays/${encodeURIComponent(pairing.display.id)}`,
    projectId: project.projectId,
    adminAccessToken: project.adminAccessToken,
    method: "DELETE",
  });
  expect(revokeResponse.status).toBe(200);

  const remainingDisplays = await adminJsonRequest({
    path: "/internal/tv-mode/displays",
    projectId: project.projectId,
    adminAccessToken: project.adminAccessToken,
  });
  expect(remainingDisplays.status).toBe(200);
  expect(remainingDisplays.body).toEqual({ displays: [] });
});
