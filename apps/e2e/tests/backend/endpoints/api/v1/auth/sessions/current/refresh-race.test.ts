import { randomUUID } from "node:crypto";
import { generatedEmailSuffix } from "../../../../../../../helpers";
import { it } from "../../../../../../../helpers";
import { Auth, backendContext, createMailbox, niceBackendFetch } from "../../../../../../backend-helpers";

// Reproduces Sentry STACK-BACKEND-146:
// PrismaClientKnownRequestError P2025 on projectUserRefreshToken.update()
// caused by the refresh endpoint reading the token, then calling update()
// after a concurrent sign-out has deleted the row.
it("reproduces P2025 when a refresh races with a sign-out of the same session", { timeout: 120_000 }, async ({ expect }) => {
  // Fire many refresh+signout pairs concurrently to hit the race window
  // between findFirst(refreshToken) and projectUserRefreshToken.update().
  const ATTEMPTS = 10;
  const crashes: any[] = [];

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

    const [refreshRes] = await Promise.all([refreshP, signOutP]);

    // Acceptable outcomes:
    //   200 (refresh won the race)
    //   401 REFRESH_TOKEN_NOT_FOUND_OR_EXPIRED (sign-out won cleanly)
    // Bug outcome: 500 with Prisma P2025 bubbling out as an unhandled error.
    if (refreshRes.status !== 200 && refreshRes.status !== 401) {
      crashes.push({ status: refreshRes.status, body: refreshRes.body });
    } else if (
      typeof refreshRes.body === "object" &&
      refreshRes.body !== null &&
      JSON.stringify(refreshRes.body).includes("P2025")
    ) {
      crashes.push({ status: refreshRes.status, body: refreshRes.body });
    }
  }

  expect(crashes).toEqual([]);
});
