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
    for (let attempt = 0; attempt < 40; attempt++) {
      response = await niceBackendFetch("/api/v1/internal/compliance/security-events", {
        accessType: "admin",
        query: {
          from: new Date(Date.now() - 60_000).toISOString(),
          to: new Date(Date.now() + 60_000).toISOString(),
        },
      });
      // ClickHouse writes are eventually consistent, so wait until BOTH the failed and successful
      // rows are visible; breaking on the first matching row races the success insert (flaky CI).
      const matching = response.status === 200
        ? response.body.events.filter((event: { email: string | null }) => event.email === email)
        : [];
      if (
        matching.some((event: { outcome: string | null }) => event.outcome === "failed")
        && matching.some((event: { outcome: string | null }) => event.outcome === "success")
      ) {
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
    expect(response?.body.summary["sign_in_attempt.invalid_password"]).toBe(1);
    expect(response?.body.summary["sign_in_attempt.failed"]).toBe(1);
    expect(response?.body.summary.sign_in_attempt).toBeGreaterThanOrEqual(2);
    expect(response?.body.summary.sign_in_attempt).toBeGreaterThanOrEqual(
      response?.body.summary["sign_in_attempt.failed"] + response?.body.summary["sign_in_attempt.success"],
    );
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
