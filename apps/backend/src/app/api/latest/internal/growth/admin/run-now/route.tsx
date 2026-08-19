import { runGrowthWatchdogSweep } from "@/lib/growth/watchdog";
import { runWorkflowEngineStep } from "@/lib/workflows/engine";
import { ensurePlatformAdmin } from "@/lib/platform-admin";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { KnownErrors } from "@hexclave/shared";
import { adaptSchema, clientOrHigherAuthTypeSchema, yupBoolean, yupMixed, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";

const INTERNAL_PROJECT_ID = "internal";
const MANUAL_STEP_DEADLINE_MS = 3 * 60 * 1000;

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const maxDuration = 300;

/**
 * Runs one server-side scheduler step from the internal GTM admin page. This is intentionally a
 * user-authenticated route rather than a browser-visible CRON_SECRET route: Preview deployments do
 * not receive scheduled Vercel Cron invocations, and the cron secret must never reach dashboard JS.
 */
export const POST = createSmartRouteHandler({
  metadata: {
    summary: "Run Growth scheduler step",
    description: "Run one workflow-engine or Growth-watchdog step from the internal Growth admin page.",
    tags: ["Growth"],
    hidden: true,
  },
  request: yupObject({
    auth: yupObject({ type: clientOrHigherAuthTypeSchema.defined(), project: adaptSchema.defined(), user: adaptSchema }).defined(),
    method: yupString().oneOf(["POST"]).defined(),
    body: yupObject({ step: yupString().oneOf(["workflow_engine", "growth_watchdog"]).defined() }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupMixed().defined(),
  }),
  handler: async ({ auth, body }) => {
    if (auth.user == null) throw new KnownErrors.UserAuthenticationRequired();
    if (auth.project.id !== INTERNAL_PROJECT_ID) throw new KnownErrors.ExpectedInternalProject();
    await ensurePlatformAdmin(auth.user);

    const deadlineMs = Date.now() + MANUAL_STEP_DEADLINE_MS;
    const result = body.step === "workflow_engine"
      ? await runWorkflowEngineStep({ deadlineMs })
      : await runGrowthWatchdogSweep({ deadlineMs });

    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        step: body.step,
        did_work: result.didWork,
      },
    };
  },
});
