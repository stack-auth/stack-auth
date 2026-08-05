import * as Sentry from "@sentry/node";
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
  if (!request.headers.get("user-agent")?.includes("vercel-cron")) {
    return callback();
  }
  const cron = vercelCronsByPath.get(normalizedPath);
  if (cron == null) {
    return callback();
  }
  return runMonitor(cron.path, callback, {
    maxRuntime: 60 * 12,
    schedule: {
      type: "crontab",
      value: cron.schedule,
    },
  });
}

import.meta.vitest?.test("Vercel cron requests retain their configured Sentry monitor", ({ expect }) => {
  const calls: { monitorSlug: string, monitorConfig: MonitorConfig }[] = [];
  const runMonitor: MonitorRunner = (monitorSlug, callback, monitorConfig) => {
    calls.push({ monitorSlug, monitorConfig });
    return callback();
  };
  const result = withVercelCronMonitor(
    new Request("http://localhost/api/latest/internal/workflow-engine-step", {
      headers: { "user-agent": "vercel-cron/1.0" },
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
            "maxRuntime": 720,
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

import.meta.vitest?.test("ordinary requests do not create Sentry cron check-ins", ({ expect }) => {
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
