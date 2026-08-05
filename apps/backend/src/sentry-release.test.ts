import { describe, expect, it } from "vitest";
import { getSentryRelease } from "./sentry-release";

describe("getSentryRelease", () => {
  it("uses the same immutable deployment identifier at build time and runtime", () => {
    expect(getSentryRelease({
      packageName: "@hexclave/backend",
      packageVersion: "1.2.3",
      environment: {
        VERCEL_GIT_COMMIT_SHA: "commit-123",
      },
    })).toBe("commit-123");
  });

  it("falls back to a sanitized package release", () => {
    expect(getSentryRelease({
      packageName: "@hexclave/backend",
      packageVersion: "1.2.3",
      environment: {},
    })).toBe("@hexclave-backend@1.2.3");
  });

  it("ignores empty release variables so source-map fallback still works", () => {
    expect(getSentryRelease({
      packageName: "@hexclave/backend",
      packageVersion: "1.2.3",
      environment: {
        SENTRY_RELEASE: "",
        VERCEL_GIT_COMMIT_SHA: "   ",
        GITHUB_SHA: "commit-456",
      },
    })).toBe("commit-456");
  });

  it("does not use Cloud Run metadata that is unavailable during the image build", () => {
    const buildRelease = getSentryRelease({
      packageName: "@hexclave/backend",
      packageVersion: "1.2.3",
      environment: {},
    });
    const runtimeRelease = getSentryRelease({
      packageName: "@hexclave/backend",
      packageVersion: "1.2.3",
      environment: {
        K_REVISION: "backend-00042-abc",
      },
    });

    expect(runtimeRelease).toBe(buildRelease);
  });
});
