import {
  discoverEnabledScheduledAutomationRules,
  enqueueScheduledAutomationRuns,
  normalizeScheduledAutomationDiscoveryLimit,
  normalizeScheduledAutomationRunPageLimit,
} from "@/lib/automations/scheduler";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { yupBoolean, yupNumber, yupObject, yupString, yupTuple } from "@hexclave/shared/dist/schema-fields";
import { getEnvVariable } from "@hexclave/shared/dist/utils/env";
import { StatusError } from "@hexclave/shared/dist/utils/errors";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export const GET = createSmartRouteHandler({
  metadata: {
    summary: "Schedule automation rule runs",
    description: "Internal endpoint invoked by cron to enqueue bounded scheduled automation rule runs.",
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
      cursor: yupString().optional(),
      max_tenancies: yupString().optional(),
      limit: yupString().optional(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      ok: yupBoolean().defined(),
      tenancies_scanned: yupNumber().integer().defined(),
      rules_found: yupNumber().integer().defined(),
      runs_enqueued: yupNumber().integer().defined(),
      next_cursor: yupString().nullable().defined(),
    }).defined(),
  }),
  handler: async ({ auth, headers, query }) => {
    const isAdmin = auth?.type === "admin" && auth.project.id === "internal";
    const authHeader = headers.authorization?.[0];
    if (!isAdmin && authHeader !== `Bearer ${getEnvVariable("CRON_SECRET")}`) {
      throw new StatusError(401, "Unauthorized");
    }

    const discovery = await discoverEnabledScheduledAutomationRules({
      limit: parseOptionalPositiveInteger(query.max_tenancies, "max_tenancies"),
      cursor: query.cursor,
    });
    const enqueueResult = await enqueueScheduledAutomationRuns({
      targets: discovery.targets,
      limit: parseOptionalPositiveInteger(query.limit, "limit"),
      scheduledAt: new Date(),
    });

    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        ok: true,
        tenancies_scanned: discovery.scannedTenancyCount,
        rules_found: discovery.targets.length,
        runs_enqueued: enqueueResult.enqueuedCount,
        next_cursor: discovery.nextCursor,
      },
    };
  },
});

function parseOptionalPositiveInteger(value: string | null | undefined, label: "max_tenancies" | "limit") {
  if (value == null || value === "") {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1 || String(parsed) !== value) {
    throw new StatusError(400, `${label} must be a positive integer`);
  }
  return label === "max_tenancies"
    ? normalizeScheduledAutomationDiscoveryLimit(parsed)
    : normalizeScheduledAutomationRunPageLimit(parsed);
}
