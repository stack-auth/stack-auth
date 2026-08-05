import * as Sentry from "@sentry/node";
import { getEnvVariable } from "@hexclave/shared/dist/utils/env";
import vercelConfig from "../../vercel.json";

type MonitorConfig = NonNullable<Parameters<typeof Sentry.withMonitor>[2]>;
type MonitorRunner = (
  monitorSlug: string,
  callback: () => Promise<Response>,
  monitorConfig: MonitorConfig,
) => Promise<Response>;

class FailedCronResponseError extends Error {
  constructor(readonly response: Response) {
    super(`Vercel cron handler returned HTTP ${response.status}`);
    this.name = "FailedCronResponseError";
  }
}

const vercelCronsByPath = new Map(
  vercelConfig.crons.map((cron) => [cron.path, cron]),
);

/**
 * Preserves the behavior of Sentry's removed Next.js Vercel Cron integration:
 * only genuine Vercel Cron requests create check-ins, and the configured path
 * remains the monitor slug so existing monitors continue receiving check-ins.
 */
export async function withVercelCronMonitor(
  request: Request,
  normalizedPath: string,
  callback: () => Promise<Response>,
  runMonitor: MonitorRunner = Sentry.withMonitor,
): Promise<Response> {
  const cronSecret = getEnvVariable("CRON_SECRET", "");
  if (cronSecret === ""
    || request.headers.get("user-agent") !== "vercel-cron/1.0"
    || request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return await callback();
  }
  const cron = vercelCronsByPath.get(normalizedPath);
  if (cron == null) {
    return await callback();
  }
  try {
    return await runMonitor(cron.path, async () => {
      const response = await callback();
      // Sentry's withMonitor treats any resolved callback as a successful check-in. Route
      // handlers resolve normally for HTTP error responses, so temporarily reject here to
      // mark the monitor as failed, then recover the original Response below. This preserves
      // the exact status, headers, and body returned to Vercel while keeping cron telemetry
      // aligned with the scheduler-visible outcome.
      if (!response.ok) {
        throw new FailedCronResponseError(response);
      }
      return response;
    }, {
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
  } catch (error) {
    if (error instanceof FailedCronResponseError) {
      return error.response;
    }
    throw error;
  }
}

const vitest = import.meta.vitest;
if (vitest != null) {
  const { afterEach, expect, test, vi } = vitest;
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test("Vercel cron requests retain their configured Sentry monitor", async ({ expect }) => {
    vi.stubEnv("CRON_SECRET", "test-cron-secret");
    const calls: { monitorSlug: string, monitorConfig: MonitorConfig }[] = [];
    const runMonitor: MonitorRunner = async (monitorSlug, callback, monitorConfig) => {
      calls.push({ monitorSlug, monitorConfig });
      return await callback();
    };
    const result = await withVercelCronMonitor(
      new Request("http://localhost/api/latest/internal/workflow-engine-step", {
        headers: {
          authorization: "Bearer test-cron-secret",
          "user-agent": "vercel-cron/1.0",
        },
      }),
      "/api/latest/internal/workflow-engine-step",
      async () => new Response("completed"),
      runMonitor,
    );

    expect({ resultStatus: result.status, calls }).toMatchInlineSnapshot(`
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
        "resultStatus": 200,
      }
    `);
  });

  test.each([401, 500])(
    "Vercel cron HTTP %s responses produce failed check-ins without changing the response",
    async (status) => {
      vi.stubEnv("CRON_SECRET", "test-cron-secret");
      const monitorOutcomes: string[] = [];
      const runMonitor: MonitorRunner = async (_monitorSlug, callback) => {
        try {
          const result = await callback();
          monitorOutcomes.push("ok");
          return result;
        } catch (error) {
          monitorOutcomes.push("error");
          throw error;
        }
      };
      const response = await withVercelCronMonitor(
        new Request("http://localhost/api/latest/internal/email-queue-step", {
          headers: {
            authorization: "Bearer test-cron-secret",
            "user-agent": "vercel-cron/1.0",
          },
        }),
        "/api/latest/internal/email-queue-step",
        async () => new Response("original body", {
          status,
          headers: {
            "x-original-header": "preserved",
          },
        }),
        runMonitor,
      );

      expect({
        status: response.status,
        body: await response.text(),
        originalHeader: response.headers.get("x-original-header"),
        monitorOutcomes,
      }).toEqual({
        status,
        body: "original body",
        originalHeader: "preserved",
        monitorOutcomes: ["error"],
      });
    },
  );

  test("ordinary requests do not create Sentry cron check-ins", async ({ expect }) => {
    vi.stubEnv("CRON_SECRET", "test-cron-secret");
    let monitorCalls = 0;
    const runMonitor: MonitorRunner = async (_monitorSlug, callback) => {
      monitorCalls++;
      return await callback();
    };
    const result = await withVercelCronMonitor(
      new Request("http://localhost/api/latest/internal/email-queue-step"),
      "/api/latest/internal/email-queue-step",
      async () => new Response("completed"),
      runMonitor,
    );

    expect({ resultStatus: result.status, monitorCalls }).toEqual({ resultStatus: 200, monitorCalls: 0 });
  });

  test("spoofed Vercel cron requests do not create check-ins", async ({ expect }) => {
    vi.stubEnv("CRON_SECRET", "test-cron-secret");
    let monitorCalls = 0;
    const result = await withVercelCronMonitor(
      new Request("http://localhost/api/latest/internal/email-queue-step", {
        headers: {
          authorization: "Bearer wrong-secret",
          "user-agent": "custom-vercel-cron-client",
        },
      }),
      "/api/latest/internal/email-queue-step",
      async () => new Response("completed"),
      async (_monitorSlug, callback) => {
        monitorCalls++;
        return await callback();
      },
    );

    expect({ resultStatus: result.status, monitorCalls }).toEqual({ resultStatus: 200, monitorCalls: 0 });
  });
}
