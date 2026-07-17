import {
  runScheduledAutomations,
  scheduledAutomationDiscoveryLimit,
  scheduledAutomationMaxPages,
  scheduledAutomationRunPageLimit,
  scheduledAutomationWorkBudgetMs,
} from "@/lib/automations/scheduler";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { yupBoolean, yupNumber, yupObject, yupString, yupTuple } from "@hexclave/shared/dist/schema-fields";
import { getEnvVariable } from "@hexclave/shared/dist/utils/env";
import { StatusError } from "@hexclave/shared/dist/utils/errors";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const maxDuration = 60;

export const GET = createSmartRouteHandler({
  metadata: {
    summary: "Run scheduled automation rules",
    description: "Internal endpoint invoked by cron to execute bounded scheduled automation work.",
    tags: ["Automations"],
    hidden: true,
  },
  request: yupObject({
    auth: yupObject({}).nullable().optional(),
    method: yupString().oneOf(["GET"]).defined(),
    headers: yupObject({
      authorization: yupTuple([yupString().defined()]).optional(),
    }).defined(),
    query: yupObject({
      max_tenancies: yupString().optional(),
      limit: yupString().optional(),
      max_pages: yupString().optional(),
      max_duration_ms: yupString().optional(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      ok: yupBoolean().defined(),
      status: yupString().oneOf(["ran", "lease-held"]).defined(),
      tenancies_scanned: yupNumber().integer().defined(),
      rules_processed: yupNumber().integer().defined(),
      pages_processed: yupNumber().integer().defined(),
      evaluated_count: yupNumber().integer().defined(),
      sent_count: yupNumber().integer().defined(),
      suppressed_count: yupNumber().integer().defined(),
      cycle_completed: yupBoolean().defined(),
    }).defined(),
  }),
  handler: async ({ auth, headers, query }) => {
    const isAdmin = auth?.type === "admin" && auth.project.id === "internal";
    const authHeader = headers.authorization?.[0];
    if (!isAdmin && authHeader !== `Bearer ${getEnvVariable("CRON_SECRET")}`) {
      throw new StatusError(401, "Unauthorized");
    }

    const result = await runScheduledAutomations({
      maxTenancies: parseAutomationScheduleBound(query.max_tenancies, "max_tenancies", scheduledAutomationDiscoveryLimit),
      pageLimit: parseAutomationScheduleBound(query.limit, "limit", scheduledAutomationRunPageLimit),
      maxPages: parseAutomationScheduleBound(query.max_pages, "max_pages", scheduledAutomationMaxPages),
      workBudgetMs: parseAutomationScheduleBound(query.max_duration_ms, "max_duration_ms", scheduledAutomationWorkBudgetMs),
    });

    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        ok: true,
        status: result.status,
        tenancies_scanned: result.tenanciesScanned,
        rules_processed: result.rulesProcessed,
        pages_processed: result.pagesProcessed,
        evaluated_count: result.evaluatedCount,
        sent_count: result.sentCount,
        suppressed_count: result.suppressedCount,
        cycle_completed: result.cycleCompleted,
      },
    };
  },
});

export function parseAutomationScheduleBound(value: string | null | undefined, label: string, maximum: number) {
  if (value == null || value === "") {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > maximum || String(parsed) !== value) {
    throw new StatusError(400, `${label} must be an integer between 1 and ${maximum}`);
  }
  return parsed;
}
