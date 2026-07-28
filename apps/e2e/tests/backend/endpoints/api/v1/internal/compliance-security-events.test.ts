import { wait } from "@hexclave/shared/dist/utils/promises";
import { describe } from "vitest";
import { it } from "../../../../../helpers";
import { Auth, Project, backendContext, niceBackendFetch } from "../../../../backend-helpers";

describe("Compliance Center security events", () => {
  it("records failed and successful password sign-in attempts", async ({ expect }) => {
    await Project.createAndSwitch({ config: {} });
    const { email, password, userId } = await Auth.Password.signUpWithEmail({ noWaitForEmail: true });

    const failedResponse = await niceBackendFetch("/api/v1/auth/password/sign-in", {
      method: "POST",
      accessType: "client",
      body: { email, password: `${password}-wrong` },
    });
    expect(failedResponse.status).toBe(400);

    await Auth.Password.signInWithEmail({ password });

    let response;
    for (let attempt = 0; attempt < 20; attempt++) {
      response = await niceBackendFetch("/api/v1/internal/compliance/security-events", {
        accessType: "admin",
        query: {
          from: new Date(Date.now() - 60_000).toISOString(),
          to: new Date(Date.now() + 60_000).toISOString(),
        },
      });
      if (response.status === 200 && response.body.events.some((event: { email: string | null }) => event.email === email)) {
        break;
      }
      await wait(500);
    }
    expect(response?.status).toBe(200);
    const events = response?.body.events.filter((event: { email: string | null }) => event.email === email);
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        category: "sign_in_attempt",
        outcome: "failed",
        method: "password",
        failure_reason: "invalid_password",
        email,
      }),
      expect.objectContaining({
        category: "sign_in_attempt",
        outcome: "success",
        method: "password",
        user_id: userId,
        email,
      }),
    ]));
    expect(response?.body.summary.invalid_password).toBeGreaterThanOrEqual(1);
  });

  it("returns the security posture and access review shapes", async ({ expect }) => {
    await Project.createAndSwitch({ config: {} });
    const posture = await niceBackendFetch("/api/v1/internal/compliance/security-posture", { accessType: "admin" });
    expect(posture.status).toBe(200);
    expect(posture.body.controls).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "password_enabled" }),
      expect.objectContaining({ key: "email_verification_required" }),
    ]));

    const accessReview = await niceBackendFetch("/api/v1/internal/compliance/access-review", { accessType: "admin" });
    expect(accessReview.status).toBe(200);
    expect(accessReview.body).toMatchObject({
      users: expect.any(Array),
      capped: expect.any(Boolean),
      limit: 1000,
    });
  });
});
