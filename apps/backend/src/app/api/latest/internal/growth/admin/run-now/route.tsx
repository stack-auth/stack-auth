import { repairGrowthProject, runGrowthProjectAnalysisStep } from "@/lib/growth/admin-recovery";
import { requireGrowthAdminTenancy } from "@/lib/growth/admin";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { KnownErrors } from "@hexclave/shared";
import { adaptSchema, clientOrHigherAuthTypeSchema, yupMixed, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";

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
    description: "Advance or repair one selected project's Growth analysis from the internal Growth admin page.",
    tags: ["Growth"],
    hidden: true,
  },
  request: yupObject({
    auth: yupObject({ type: clientOrHigherAuthTypeSchema.defined(), project: adaptSchema.defined(), user: adaptSchema }).defined(),
    method: yupString().oneOf(["POST"]).defined(),
    body: yupObject({ step: yupString().oneOf(["analysis_tick", "project_recovery"]).defined(), target_project_id: yupString().defined() }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupMixed().defined(),
  }),
  handler: async ({ auth, body }) => {
    if (auth.user == null) throw new KnownErrors.UserAuthenticationRequired();
    const tenancy = await requireGrowthAdminTenancy(auth.project.id, auth.user, body.target_project_id);
    const result = body.step === "analysis_tick"
      ? await runGrowthProjectAnalysisStep(tenancy)
      : await repairGrowthProject(tenancy);

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
