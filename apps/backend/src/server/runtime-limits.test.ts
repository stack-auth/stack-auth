import vercelConfig from "../../vercel.json";
import { routeModules } from "@/generated/route-modules";
import { DEFAULT_ROUTE_MAX_DURATION_SECONDS, VERCEL_FUNCTION_MAX_DURATION_SECONDS } from "./runtime-limits";
import { test } from "vitest";

test("the shared Elysia function supports the longest backend routes", ({ expect }) => {
  expect(vercelConfig.functions["src/index.ts"].maxDuration).toBe(VERCEL_FUNCTION_MAX_DURATION_SECONDS);
});

test("logical routes retain their individual duration budgets", ({ expect }) => {
  const durationsByPath = new Map(routeModules.map((route) => [
    route.normalizedPath,
    route.maxDurationSeconds ?? DEFAULT_ROUTE_MAX_DURATION_SECONDS,
  ]));

  expect({
    defaultRoute: durationsByPath.get("/api/latest/users"),
    deployment: durationsByPath.get("/api/latest/deployments/services/[service_id]/deploy"),
    configApply: durationsByPath.get("/api/latest/internal/config/github/apply"),
    configCancel: durationsByPath.get("/api/latest/internal/config/github/cancel"),
    configCommit: durationsByPath.get("/api/latest/internal/config/github/commit"),
    workflow: durationsByPath.get("/api/latest/internal/workflow-engine-step"),
  }).toEqual({
    defaultRoute: 300,
    deployment: 300,
    configApply: 800,
    configCancel: 60,
    configCommit: 120,
    workflow: 800,
  });
});
