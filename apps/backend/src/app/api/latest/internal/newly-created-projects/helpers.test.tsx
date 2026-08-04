import { describe, expect, it } from "vitest";
import {
  getEmailSetup,
  getEnabledAppIds,
  getClickHouseMetricsErrorMessage,
  getTrustedDomainBaseUrls,
  isStripeAccountSetupComplete,
  mergeProjectActivityMetricsRows,
  selectProjectsWithInternalPinned,
} from "./helpers";

describe("newly-created-projects helpers", () => {
  it("reads enabled apps from normalized nested config", () => {
    expect(getEnabledAppIds({
      apps: {
        installed: {
          authentication: { enabled: true },
          teams: { enabled: true },
          rbac: { enabled: false },
          neon: { enabled: true },
        },
      },
    })).toEqual(["authentication", "neon", "teams"]);
  });

  it("reads and sorts trusted domains from normalized config", () => {
    expect(getTrustedDomainBaseUrls({
      domains: {
        trustedDomains: {
          second: { baseUrl: "https://b.example.com" },
          first: { baseUrl: "https://a.example.com" },
          incomplete: {},
        },
      },
    })).toEqual([
      "https://a.example.com",
      "https://b.example.com",
    ]);
  });

  it("distinguishes shared servers, custom domains, and custom servers", () => {
    expect(getEmailSetup({
      emails: {
        server: {
          isShared: false,
          provider: "managed",
          managedSubdomain: "updates.example.com",
          senderEmail: "hello@updates.example.com",
        },
      },
    })).toMatchInlineSnapshot(`
      {
        "kind": "custom-domain",
        "managed_subdomain": "updates.example.com",
        "provider": "managed",
        "sender_email": "hello@updates.example.com",
      }
    `);
    expect(getEmailSetup({
      emails: {
        server: {
          isShared: false,
          provider: "smtp",
        },
      },
    }).kind).toBe("custom-server");
  });

  it("requires every Stripe onboarding capability for setup completion", () => {
    expect(isStripeAccountSetupComplete({
      charges_enabled: true,
      details_submitted: true,
      payouts_enabled: true,
    })).toBe(true);
    expect(isStripeAccountSetupComplete({
      charges_enabled: true,
      details_submitted: false,
      payouts_enabled: true,
    })).toBe(false);
  });

  it("pins the internal project inside the configured result limit", () => {
    expect(selectProjectsWithInternalPinned([
      { id: "newest" },
      { id: "second" },
      { id: "internal" },
    ], 2)).toEqual([
      { id: "newest" },
      { id: "internal" },
    ]);
  });

  it("merges per-project activity rows from disjoint ClickHouse chunks", () => {
    const metrics = mergeProjectActivityMetricsRows(
      [
        { projectId: "project-a", nonAnon: "2", anon: 1 },
        { projectId: "project-b", nonAnon: 3, anon: "4" },
      ],
      [
        { projectId: "project-a", lastActive: "2026-01-02 03:04:05" },
        { projectId: "project-b", lastActive: "2026-01-03T04:05:06Z" },
      ],
    );

    expect({
      nonAnon: [...metrics.nonAnonByProjectId.entries()],
      anon: [...metrics.anonByProjectId.entries()],
      lastActivity: [...metrics.lastActivityByProjectId.entries()].map(([projectId, date]) => [
        projectId,
        date.toISOString(),
      ]),
    }).toMatchInlineSnapshot(`
      {
        "anon": [
          [
            "project-a",
            1,
          ],
          [
            "project-b",
            4,
          ],
        ],
        "lastActivity": [
          [
            "project-a",
            "2026-01-02T03:04:05.000Z",
          ],
          [
            "project-b",
            "2026-01-03T04:05:06.000Z",
          ],
        ],
        "nonAnon": [
          [
            "project-a",
            2,
          ],
          [
            "project-b",
            3,
          ],
        ],
      }
    `);
  });

  it("makes an empty ClickHouse cause actionable", () => {
    expect(getClickHouseMetricsErrorMessage(new Error(""), 50_000, 15))
      .toBe("ClickHouse rejected the metrics request for 50000 project IDs across 15 chunks");
    expect(getClickHouseMetricsErrorMessage(new Error("query failed"), 1, 1))
      .toBe("query failed");
  });
});
