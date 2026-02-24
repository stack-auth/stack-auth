import { getClickhouseAdminClient } from "@/lib/clickhouse";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, adminAuthTypeSchema, yupArray, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";

const ANALYTICS_HOURS = 48;

export const GET = createSmartRouteHandler({
  metadata: {
    hidden: true,
  },
  request: yupObject({
    auth: yupObject({
      type: adminAuthTypeSchema.defined(),
      tenancy: adaptSchema.defined(),
    }),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      // Triggers per rule with hourly breakdown for sparklines
      rule_triggers: yupArray(yupObject({
        rule_id: yupString().defined(),
        total_count: yupNumber().integer().defined(),
        hourly_counts: yupArray(yupObject({
          hour: yupString().defined(),
          count: yupNumber().integer().defined(),
        }).defined()).defined(),
      }).defined()).defined(),
      // Summary stats
      total_triggers: yupNumber().integer().defined(),
      triggers_by_action: yupObject({
        allow: yupNumber().integer().defined(),
        reject: yupNumber().integer().defined(),
        restrict: yupNumber().integer().defined(),
        log: yupNumber().integer().defined(),
      }).defined(),
    }).defined(),
  }),
  handler: async (req) => {
    const projectId = req.auth.tenancy.project.id;
    const branchId = req.auth.tenancy.branchId;

    // Generate hour keys for the sparkline
    const now = new Date();
    now.setUTCMinutes(0, 0, 0);
    const since = new Date(now.getTime() - (ANALYTICS_HOURS - 1) * 60 * 60 * 1000);
    const hourKeys = Array.from({ length: ANALYTICS_HOURS }, (_, index) => {
      const hour = new Date(since.getTime() + index * 60 * 60 * 1000);
      return hour.toISOString().slice(0, 13) + ':00:00.000Z';
    });

    const client = getClickhouseAdminClient();

    const result = await client.query({
      query: `
        SELECT
          data.ruleId as rule_id,
          data.action as action,
          toStartOfHour(event_at) as hour
        FROM analytics_internal.events
        WHERE event_type = '$sign-up-rule-trigger'
          AND project_id = {projectId:String}
          AND branch_id = {branchId:String}
          AND event_at >= {since:DateTime}
        ORDER BY event_at ASC
      `,
      query_params: {
        projectId,
        branchId,
        since: since.toISOString().slice(0, 19),
      },
      format: "JSONEachRow",
    });
    const rows: {
      rule_id: string,
      action: "allow" | "reject" | "restrict" | "log",
      hour: string,
    }[] = await result.json();

    // Group by rule and hour for sparkline data
    const ruleTriggersMap = new Map<string, {
      totalCount: number,
      hourlyMap: Map<string, number>,
    }>();

    // Summary counts by action
    const actionCounts = {
      allow: 0,
      reject: 0,
      restrict: 0,
      log: 0,
    };

    for (const row of rows) {
      // Update action counts
      const action = row.action;
      if (action in actionCounts) {
        actionCounts[action]++;
      }

      // Update rule triggers
      let ruleData = ruleTriggersMap.get(row.rule_id);
      if (!ruleData) {
        ruleData = { totalCount: 0, hourlyMap: new Map() };
        ruleTriggersMap.set(row.rule_id, ruleData);
      }
      ruleData.totalCount++;

      // Group by hour (normalize to ISO format)
      // ClickHouse returns datetime without timezone, treat as UTC
      const hourKey = new Date(row.hour + 'Z').toISOString().slice(0, 13) + ':00:00.000Z';
      ruleData.hourlyMap.set(hourKey, (ruleData.hourlyMap.get(hourKey) ?? 0) + 1);
    }

    // Build hourly breakdown for each rule
    const ruleTriggers = Array.from(ruleTriggersMap.entries()).map(([ruleId, data]) => ({
      rule_id: ruleId,
      total_count: data.totalCount,
      hourly_counts: hourKeys.map((hour) => ({
        hour,
        count: data.hourlyMap.get(hour) ?? 0,
      })),
    }));

    return {
      statusCode: 200 as const,
      bodyType: "json" as const,
      body: {
        rule_triggers: ruleTriggers,
        total_triggers: rows.length,
        triggers_by_action: actionCounts,
      },
    };
  },
});
