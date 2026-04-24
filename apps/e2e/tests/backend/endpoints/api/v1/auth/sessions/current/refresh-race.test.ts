import { randomUUID } from "node:crypto";
import { generatedEmailSuffix, it } from "../../../../../../../helpers";
import { Auth, backendContext, createMailbox, niceBackendFetch } from "../../../../../../backend-helpers";

type RaceFailure = {
  readonly request: "refresh" | "sign-out",
  readonly status?: number,
  readonly body?: unknown,
  readonly error?: unknown,
};

function collectUnexpectedRaceResponseFailures(options: {
  readonly refreshResult: PromiseSettledResult<Awaited<ReturnType<typeof niceBackendFetch>>>,
  readonly signOutResult: PromiseSettledResult<Awaited<ReturnType<typeof niceBackendFetch>>>,
}): RaceFailure[] {
  const failures: RaceFailure[] = [];
  const results: [RaceFailure["request"], PromiseSettledResult<Awaited<ReturnType<typeof niceBackendFetch>>>][] = [
    ["refresh", options.refreshResult],
    ["sign-out", options.signOutResult],
  ];
  for (const [request, result] of results) {
    if (result.status === "rejected") {
      failures.push({ request, error: result.reason });
      continue;
    }
    if (result.value.status >= 500 || JSON.stringify(result.value.body).includes("P2025")) {
      failures.push({ request, status: result.value.status, body: result.value.body });
    }
  }
  return failures;
}

// Guards Sentry STACK-BACKEND-146:
// PrismaClientKnownRequestError P2025 on projectUserRefreshToken.update()
// caused by the refresh endpoint reading the token, then calling update()
// after a concurrent sign-out has deleted the row.
it("does not 500 when a refresh races with a sign-out of the same session", { timeout: 120_000 }, async ({ expect }) => {
  // Fire many refresh+signout pairs concurrently to hit the race window
  // between findFirst(refreshToken) and projectUserRefreshToken.update().
  const ATTEMPTS = 10;
  const failures: RaceFailure[] = [];

  for (let i = 0; i < ATTEMPTS; i++) {
    backendContext.set({
      mailbox: createMailbox(`refresh-race--${randomUUID()}${generatedEmailSuffix}`),
      userAuth: null,
    });
    await Auth.Password.signUpWithEmail();
    const rt = backendContext.value.userAuth!.refreshToken!;

    const refreshP = niceBackendFetch("/api/v1/auth/sessions/current/refresh", {
      method: "POST",
      accessType: "client",
      headers: { "x-stack-refresh-token": rt },
    });
    const signOutP = niceBackendFetch("/api/v1/auth/sessions/current", {
      method: "DELETE",
      accessType: "client",
    });

    const [refreshResult, signOutResult] = await Promise.allSettled([refreshP, signOutP]);
    failures.push(...collectUnexpectedRaceResponseFailures({ refreshResult, signOutResult }));

    // Acceptable outcomes:
    //   200 (refresh won the race)
    //   401 REFRESH_TOKEN_NOT_FOUND_OR_EXPIRED (sign-out won cleanly)
    // Bug outcome: 500 with Prisma P2025 bubbling out as an unhandled error.
    if (refreshResult.status === "fulfilled" && refreshResult.value.status !== 200 && refreshResult.value.status !== 401) {
      failures.push({ request: "refresh", status: refreshResult.value.status, body: refreshResult.value.body });
    }
  }

  expect(failures).toEqual([]);
});

it("does not 500 when an OAuth refresh-token grant races with a sign-out of the same session", { timeout: 120_000 }, async ({ expect }) => {
  // The OAuth token endpoint uses the same refresh-token helper as the direct
  // session refresh endpoint, so keep this regression covered on both callers.
  const ATTEMPTS = 10;
  const failures: RaceFailure[] = [];

  for (let i = 0; i < ATTEMPTS; i++) {
    backendContext.set({
      mailbox: createMailbox(`oauth-refresh-race--${randomUUID()}${generatedEmailSuffix}`),
      userAuth: null,
    });
    await Auth.Password.signUpWithEmail();
    const rt = backendContext.value.userAuth!.refreshToken!;
    const projectKeys = backendContext.value.projectKeys;
    if (projectKeys === "no-project") throw new Error("No project keys found in the backend context");

    const refreshP = niceBackendFetch("/api/v1/auth/oauth/token", {
      method: "POST",
      accessType: "client",
      body: {
        grant_type: "refresh_token",
        client_id: projectKeys.projectId,
        client_secret: projectKeys.publishableClientKey,
        refresh_token: rt,
      },
    });
    const signOutP = niceBackendFetch("/api/v1/auth/sessions/current", {
      method: "DELETE",
      accessType: "client",
    });

    const [refreshResult, signOutResult] = await Promise.allSettled([refreshP, signOutP]);
    failures.push(...collectUnexpectedRaceResponseFailures({ refreshResult, signOutResult }));

    if (refreshResult.status === "fulfilled" && refreshResult.value.status !== 200 && refreshResult.value.status !== 401) {
      failures.push({ request: "refresh", status: refreshResult.value.status, body: refreshResult.value.body });
    }
  }

  expect(failures).toEqual([]);
});
