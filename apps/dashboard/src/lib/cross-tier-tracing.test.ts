import { describe, expect, it } from "vitest";
import { createDashboardTracePropagationTargets, createStackApiOriginTraceTargets, resolveDashboardSentryDsn, shouldEnableDashboardTracePropagation } from "./cross-tier-tracing";

function matchesAny(targets: readonly RegExp[], url: string): boolean {
  return targets.some((target) => target.test(url));
}

describe("cross-tier trace propagation targets", () => {
  it("propagates only to the configured API origins", () => {
    const targets = createStackApiOriginTraceTargets([
      "https://api.example.test/api/latest",
      "https://api.example.test/duplicate-path",
      "http://localhost:8102",
    ]);

    expect({
      configuredProductionApi: matchesAny(targets, "https://api.example.test/api/latest/users"),
      configuredLocalApi: matchesAny(targets, "http://localhost:8102/api/latest/users"),
      lookalikeOrigin: matchesAny(targets, "https://api.example.test.attacker.test/api/latest/users"),
      unrelatedOrigin: matchesAny(targets, "https://example.test/api/latest/users"),
      deduplicatedTargetCount: targets.length,
    }).toMatchInlineSnapshot(`
      {
        "configuredLocalApi": true,
        "configuredProductionApi": true,
        "deduplicatedTargetCount": 2,
        "lookalikeOrigin": false,
        "unrelatedOrigin": false,
      }
    `);
  });

  it("also propagates dashboard traces to same-origin API routes", () => {
    const targets = createDashboardTracePropagationTargets(["https://api.example.test"]);

    expect({
      relativeApi: matchesAny(targets, "/api/viewer-location"),
      relativeAsset: matchesAny(targets, "/images/logo.svg"),
      protocolRelativeLookalike: matchesAny(targets, "//api.example.test.attacker.test/api/latest"),
    }).toMatchInlineSnapshot(`
      {
        "protocolRelativeLookalike": false,
        "relativeApi": true,
        "relativeAsset": false,
      }
    `);
  });

  it("keeps browser propagation enabled locally without enabling it in CI", () => {
    expect({
      localDevelopment: shouldEnableDashboardTracePropagation(undefined),
      emptyCiVariable: shouldEnableDashboardTracePropagation(""),
      ci: shouldEnableDashboardTracePropagation("true"),
    }).toMatchInlineSnapshot(`
      {
        "ci": false,
        "emptyCiVariable": true,
        "localDevelopment": true,
      }
    `);
  });

  it("uses a local-only DSN so Sentry installs browser tracing without an external transport", () => {
    expect({
      localDevelopment: resolveDashboardSentryDsn(undefined, true),
      productionWithoutConfiguration: resolveDashboardSentryDsn(undefined, false),
      configured: resolveDashboardSentryDsn("https://public@example.test/1", true),
    }).toMatchInlineSnapshot(`
      {
        "configured": "https://public@example.test/1",
        "localDevelopment": "https://development@localhost/1",
        "productionWithoutConfiguration": undefined,
      }
    `);
  });
});
