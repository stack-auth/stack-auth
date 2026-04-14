import { describe } from "vitest";
import { it } from "../../../../../helpers";
import { niceBackendFetch } from "../../../../backend-helpers";

describe("GET /api/v1/internal/component-versions", () => {
  it("should return page versions and changelogs", async ({ expect }) => {
    const response = await niceBackendFetch("/api/v1/internal/component-versions", {
      method: "GET",
    });

    expect(response.status).toBe(200);

    const body = response.body;
    expect(body).toHaveProperty("versions");
    expect(typeof body.versions).toBe("object");

    const expectedPages = [
      "signIn",
      "signUp",
      "signOut",
      "emailVerification",
      "passwordReset",
      "forgotPassword",
      "oauthCallback",
      "magicLinkCallback",
      "accountSettings",
      "teamInvitation",
      "mfa",
      "error",
      "onboarding",
    ];

    for (const page of expectedPages) {
      expect(body.versions).toHaveProperty(page);
      expect(body.versions[page]).toHaveProperty("version");
      expect(typeof body.versions[page].version).toBe("number");
      expect(body.versions[page]).toHaveProperty("changelogs");
      expect(typeof body.versions[page].changelogs).toBe("object");
    }
  });

  it("should reject non-GET methods", async ({ expect }) => {
    const response = await niceBackendFetch("/api/v1/internal/component-versions", {
      method: "POST",
      body: {},
    });

    expect(response.status).toBe(405);
  });
});
