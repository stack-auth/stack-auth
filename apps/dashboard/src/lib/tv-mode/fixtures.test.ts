import { describe, expect, it } from "vitest";
import { TV_FIXTURE_VARIANTS, TV_SCREEN_IDS, TvSnapshotSchema, type TvFixtureVariant } from "./types";
import {
  calculateFixtureEmailRates,
  calculateFixturePaymentSuccess,
  createTvFixtureSnapshot,
  getTvProfileFixture,
  TV_PROFILE_FIXTURES,
} from "./fixtures";

function getProfile(id = "company-pulse") {
  const profile = getTvProfileFixture(id);
  if (profile == null) throw new Error("Fixture profile is missing");
  return profile;
}

describe("TV Mode centralized fixtures", () => {
  it("validates every deterministic fixture through the shared runtime schema", async () => {
    for (const profile of TV_PROFILE_FIXTURES) {
      for (const variant of TV_FIXTURE_VARIANTS) {
        await expect(TvSnapshotSchema.validate(
          createTvFixtureSnapshot("project-fixture", profile, variant),
          { strict: true },
        )).resolves.toBeDefined();
      }
    }
  });

  it("registers the approved four-screen General Mode playlist", () => {
    expect(TV_PROFILE_FIXTURES.map((profile) => ({
      id: profile.id,
      mode: profile.mode,
      screens: profile.playlist.map((entry) => entry.screenId),
    }))).toMatchInlineSnapshot(`
      [
        {
          "id": "engineering-office",
          "mode": "general",
          "screens": [
            "live-pulse",
            "audience-momentum",
            "revenue-payments",
            "email-health",
          ],
        },
        {
          "id": "company-pulse",
          "mode": "general",
          "screens": [
            "live-pulse",
            "audience-momentum",
            "revenue-payments",
            "email-health",
          ],
        },
      ]
    `);
    expect(new Set(TV_PROFILE_FIXTURES.flatMap((profile) => profile.playlist.map((entry) => entry.screenId))))
      .toEqual(new Set(TV_SCREEN_IDS));
  });

  it("keeps reporting windows and deterministic evidence in the snapshot", () => {
    const snapshot = createTvFixtureSnapshot("project-fixture", getProfile());
    expect(snapshot.screens.map((screen) => ({
      id: screen.id,
      window: screen.window.current.label,
      comparison: screen.window.comparison?.label ?? null,
      insight: screen.insight?.kind ?? null,
    }))).toMatchInlineSnapshot(`
      [
        {
          "comparison": null,
          "id": "live-pulse",
          "insight": "live-activity-above-baseline",
          "window": "Today · UTC",
        },
        {
          "comparison": "Previous 7 days",
          "id": "audience-momentum",
          "insight": "returning-users-leading",
          "window": "Trailing 7 days",
        },
        {
          "comparison": "Previous 30 days",
          "id": "revenue-payments",
          "insight": "revenue-up-payments-stable",
          "window": "Trailing 30 days",
        },
        {
          "comparison": "Previous 7 days",
          "id": "email-health",
          "insight": "delivery-healthy-volume-up",
          "window": "Trailing 7 days",
        },
      ]
    `);
  });

  it("models non-data states without metric payloads and stale with last-safe data", () => {
    for (const variant of ["empty", "unavailable"] satisfies TvFixtureVariant[]) {
      const snapshot = createTvFixtureSnapshot("project-fixture", getProfile(), variant);
      expect(snapshot.screens.every((screen) => screen.data == null && screen.insight == null)).toBe(true);
    }
    const stale = createTvFixtureSnapshot("project-fixture", getProfile(), "stale");
    expect(stale.screens.every((screen) =>
      screen.sourceStatus === "stale" && screen.data != null && screen.insight == null,
    )).toBe(true);
  });

  it("isolates a partial email failure", () => {
    const snapshot = createTvFixtureSnapshot("project-fixture", getProfile(), "partial-failure");
    expect(snapshot.screens.map((screen) => `${screen.id}:${screen.sourceStatus}`)).toMatchInlineSnapshot(`
      [
        "live-pulse:ready",
        "audience-momentum:ready",
        "revenue-payments:ready",
        "email-health:error",
      ]
    `);
  });

  it("suppresses health rates and insights below minimum samples", () => {
    const snapshot = createTvFixtureSnapshot("project-fixture", getProfile(), "insufficient-data");
    const revenue = snapshot.screens.find((screen) => screen.id === "revenue-payments");
    const email = snapshot.screens.find((screen) => screen.id === "email-health");
    expect({
      revenueStatus: revenue?.sourceStatus,
      attempts: revenue?.data?.paymentSuccess.applicableAttempts,
      paymentSuccess: revenue?.data?.paymentSuccess.percent,
      revenueInsight: revenue?.insight,
      emailStatus: email?.sourceStatus,
      sends: email?.data?.sent,
      delivery: email?.data?.deliveryRatePercent,
      emailInsight: email?.insight,
    }).toMatchInlineSnapshot(`
      {
        "attempts": 9,
        "delivery": null,
        "emailInsight": null,
        "emailStatus": "insufficient-data",
        "paymentSuccess": null,
        "revenueInsight": null,
        "revenueStatus": "insufficient-data",
        "sends": 19,
      }
    `);
  });

  it("applies payment and email thresholds at their exact boundaries", () => {
    expect([
      calculateFixturePaymentSuccess(9, 9),
      calculateFixturePaymentSuccess(10, 9),
      calculateFixturePaymentSuccess(11, 10),
    ]).toEqual([null, 90, 90.9]);
    expect([
      calculateFixtureEmailRates(19, 19, 0),
      calculateFixtureEmailRates(20, 19, 1),
      calculateFixtureEmailRates(21, 20, 1),
    ]).toEqual([
      { deliveryRatePercent: null, bounceRatePercent: null },
      { deliveryRatePercent: 95, bounceRatePercent: 5 },
      { deliveryRatePercent: 95.2, bounceRatePercent: 4.8 },
    ]);
  });

  it("redacts currency fields and currency-bearing evidence", () => {
    const redacted = createTvFixtureSnapshot("project-fixture", getProfile(), "financial-redacted");
    const revenue = redacted.screens.find((screen) => screen.id === "revenue-payments");
    expect(revenue?.data?.financials.visibility).toBe("redacted");
    expect(JSON.stringify(revenue)).not.toContain("4823100");
    expect(JSON.stringify(revenue)).not.toContain("3128000");

    const profileRedacted = createTvFixtureSnapshot("project-fixture", getProfile("engineering-office"));
    const profileRevenue = profileRedacted.screens.find((screen) => screen.id === "revenue-payments");
    expect(profileRevenue?.data?.financials.visibility).toBe("redacted");
  });

  it("builds each interruption treatment centrally", () => {
    const variants: TvFixtureVariant[] = ["banner", "temporary-takeover", "critical-takeover"];
    expect(variants.map((variant) => {
      const presentation = createTvFixtureSnapshot("project-fixture", getProfile(), variant).presentation;
      return presentation.banner?.decision.treatment ?? presentation.takeover?.decision.treatment;
    })).toEqual(["banner", "temporary-takeover", "persistent-takeover"]);
  });

  it("keeps long-name stress data centralized", () => {
    const snapshot = createTvFixtureSnapshot("project-fixture", getProfile(), "long-names");
    expect(snapshot.project.displayName.length).toBeGreaterThan(50);
    expect(snapshot.profile.displayName.length).toBeGreaterThan(50);
  });
});
