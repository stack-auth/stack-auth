import * as Sentry from "@sentry/node";
import { getEnvVariable } from "@hexclave/shared/dist/utils/env";
import vercelConfig from "../../vercel.json";

type MonitorConfig = NonNullable<Parameters<typeof Sentry.withMonitor>[2]>;
type MonitorRunner = <T>(
  monitorSlug: string,
  callback: () => T,
  monitorConfig: MonitorConfig,
) => T;

const vercelCronsByPath = new Map(
  vercelConfig.crons.map((cron) => [cron.path, cron]),
);

/**
 * Preserves the behavior of Sentry's removed Next.js Vercel Cron integration:
 * only genuine Vercel Cron requests create check-ins, and the configured path
 * remains the monitor slug so existing monitors continue receiving check-ins.
 */
export function withVercelCronMonitor<T>(
  request: Request,
  normalizedPath: string,
  callback: () => T,
  runMonitor: MonitorRunner = Sentry.withMonitor,
): T {
  const cronSecret = getEnvVariable("CRON_SECRET", "");
  if (cronSecret === ""
    || request.headers.get("user-agent") !== "vercel-cron/1.0"
    || request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return callback();
  }
  const cron = vercelCronsByPath.get(normalizedPath);
  if (cron == null) {
    return callback();
  }
  return runMonitor(cron.path, callback, {
    // The longest-running cron (workflow-engine-step) may legitimately use the full
    // Vercel function budget of 800 seconds (see FUNCTION_BUDGET_MS in
    // app/api/latest/internal/workflow-engine-step/route.tsx and `maxDuration: 800` in
    // src/index.ts): ceil(800 / 60) = 14 minutes, plus one minute of slack so a
    // full-budget tick doesn't trigger a false "timed out" Sentry check-in. Revisit
    // this value if maxDuration changes.
    maxRuntime: 15,
    schedule: {
      type: "crontab",
      value: cron.schedule,
    },
  });
}

const vitest = import.meta.vitest;
if (vitest != null) {
  const { afterEach, test, vi } = vitest;
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test("Vercel cron requests retain their configured Sentry monitor", ({ expect }) => {
    vi.stubEnv("CRON_SECRET", "test-cron-secret");
    const calls: { monitorSlug: string, monitorConfig: MonitorConfig }[] = [];
    const runMonitor: MonitorRunner = (monitorSlug, callback, monitorConfig) => {
      calls.push({ monitorSlug, monitorConfig });
      return callback();
    };
    const result = withVercelCronMonitor(
      new Request("http://localhost/api/latest/internal/workflow-engine-step", {
        headers: {
          authorization: "Bearer test-cron-secret",
          "user-agent": "vercel-cron/1.0",
        },
      }),
      "/api/latest/internal/workflow-engine-step",
      () => "completed",
      runMonitor,
    );

    expect({ result, calls }).toMatchInlineSnapshot(`
      {
        "calls": [
          {
            "monitorConfig": {
              "maxRuntime": 15,
              "schedule": {
                "type": "crontab",
                "value": "* * * * *",
              },
            },
            "monitorSlug": "/api/latest/internal/workflow-engine-step",
          },
        ],
        "result": "completed",
      }
    `);
  });

  test("ordinary requests do not create Sentry cron check-ins", ({ expect }) => {
    vi.stubEnv("CRON_SECRET", "test-cron-secret");
    let monitorCalls = 0;
    const runMonitor: MonitorRunner = (_monitorSlug, callback) => {
      monitorCalls++;
      return callback();
    };
    const result = withVercelCronMonitor(
      new Request("http://localhost/api/latest/internal/email-queue-step"),
      "/api/latest/internal/email-queue-step",
      () => "completed",
      runMonitor,
    );

    expect({ result, monitorCalls }).toEqual({ result: "completed", monitorCalls: 0 });
  });

  test("spoofed Vercel cron requests do not create check-ins", ({ expect }) => {
    vi.stubEnv("CRON_SECRET", "test-cron-secret");
    let monitorCalls = 0;
    const result = withVercelCronMonitor(
      new Request("http://localhost/api/latest/internal/email-queue-step", {
        headers: {
          authorization: "Bearer wrong-secret",
          "user-agent": "custom-vercel-cron-client",
        },
      }),
      "/api/latest/internal/email-queue-step",
      () => "completed",
      (_monitorSlug, callback) => {
        monitorCalls++;
        return callback();
      },
    );

    expect({ result, monitorCalls }).toEqual({ result: "completed", monitorCalls: 0 });
  });
}
