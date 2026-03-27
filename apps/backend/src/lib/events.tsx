import { trace } from "@opentelemetry/api";
import { SeverityNumber, logs } from "@opentelemetry/api-logs";
import withPostHog from "@/analytics";
import { globalPrismaClient } from "@/prisma-client";
import { runAsynchronouslyAndWaitUntil } from "@/utils/vercel";
import { urlSchema, yupBoolean, yupMixed, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { getEnvVariable, getNodeEnvironment } from "@stackframe/stack-shared/dist/utils/env";
import { StackAssertionError, throwErr } from "@stackframe/stack-shared/dist/utils/errors";
import { HTTP_METHODS } from "@stackframe/stack-shared/dist/utils/http";
import { filterUndefined, typedKeys } from "@stackframe/stack-shared/dist/utils/objects";
import { UnionToIntersection } from "@stackframe/stack-shared/dist/utils/types";
import { generateUuid } from "@stackframe/stack-shared/dist/utils/uuids";
import * as yup from "yup";
import { getClickhouseAdminClient } from "./clickhouse";
import { getEndUserInfo } from "./end-users";
import { DEFAULT_BRANCH_ID } from "./tenancies";

export const endUserIpInfoSchema = yupObject({
  ip: yupString().defined(),
  isTrusted: yupBoolean().defined(),
  countryCode: yupString().optional(),
  regionCode: yupString().optional(),
  cityName: yupString().optional(),
  latitude: yupNumber().optional(),
  longitude: yupNumber().optional(),
  tzIdentifier: yupString().optional(),
});

export type EndUserIpInfo = yup.InferType<typeof endUserIpInfoSchema>;

type ClickhouseEndUserIpInfo = {
  ip: string,
  is_trusted: boolean,
  country_code?: string,
  region_code?: string,
  city_name?: string,
  latitude?: number,
  longitude?: number,
  tz_identifier?: string,
};

function toClickhouseEndUserIpInfo(ipInfo: EndUserIpInfo | null): ClickhouseEndUserIpInfo | null {
  if (!ipInfo) {
    return null;
  }

  return {
    ip: ipInfo.ip,
    is_trusted: ipInfo.isTrusted,
    country_code: ipInfo.countryCode ?? undefined,
    region_code: ipInfo.regionCode ?? undefined,
    city_name: ipInfo.cityName ?? undefined,
    latitude: ipInfo.latitude ?? undefined,
    longitude: ipInfo.longitude ?? undefined,
    tz_identifier: ipInfo.tzIdentifier ?? undefined,
  };
}

const analyticsLogger = logs.getLogger("stack-backend");

export type AnalyticsEventInsertRow = {
  event_type: string,
  event_id: string,
  trace_id: string | null,
  event_at: Date,
  parent_span_ids: string[],
  data: Record<string, unknown>,
  project_id: string,
  branch_id: string,
  user_id: string | null,
  team_id: string | null,
  refresh_token_id: string | null,
  session_replay_id: string | null,
  session_replay_segment_id: string | null,
  from_server: boolean,
};

type AnalyticsEventEnvelope = Omit<AnalyticsEventInsertRow, "event_at"> & {
  event_at: string,
};

import { stripLoneSurrogates } from "@/lib/analytics-validation";

function sanitizeAnalyticsEventData(data: Record<string, unknown>): Record<string, unknown> {
  const sanitized = stripLoneSurrogates(data);
  if (sanitized === null || typeof sanitized !== "object" || Array.isArray(sanitized)) {
    throw new StackAssertionError("Analytics event data must be a JSON object", { data });
  }
  return sanitized as Record<string, unknown>;
}

function toAnalyticsEventEnvelope(row: AnalyticsEventInsertRow): AnalyticsEventEnvelope {
  return {
    ...row,
    event_at: row.event_at.toISOString(),
  };
}

function getAnalyticsEventTelemetryAttributes(event: AnalyticsEventEnvelope) {
  return filterUndefined({
    "stack.analytics.event_type": event.event_type,
    "stack.analytics.event_id": event.event_id,
    "stack.analytics.trace_id": event.trace_id ?? undefined,
    "stack.analytics.event_at": event.event_at,
    "stack.analytics.parent_span_ids": event.parent_span_ids.length > 0 ? event.parent_span_ids.join(",") : undefined,
    "stack.analytics.project_id": event.project_id,
    "stack.analytics.branch_id": event.branch_id,
    "stack.analytics.user_id": event.user_id ?? undefined,
    "stack.analytics.team_id": event.team_id ?? undefined,
    "stack.analytics.refresh_token_id": event.refresh_token_id ?? undefined,
    "stack.analytics.session_replay_id": event.session_replay_id ?? undefined,
    "stack.analytics.session_replay_segment_id": event.session_replay_segment_id ?? undefined,
    "stack.analytics.data_json": JSON.stringify(event.data),
  });
}

function exportAnalyticsEvent(row: AnalyticsEventInsertRow) {
  const event = toAnalyticsEventEnvelope(row);
  const attributes = getAnalyticsEventTelemetryAttributes(event);

  analyticsLogger.emit({
    severityNumber: SeverityNumber.INFO,
    severityText: "INFO",
    body: JSON.stringify(event),
    attributes,
  });

  trace.getActiveSpan()?.addEvent("stack.analytics.event", attributes);

  console.info(JSON.stringify({
    type: "stack.analytics.event",
    ...event,
  }));
}

export async function insertAnalyticsEvents(rows: AnalyticsEventInsertRow[]): Promise<void> {
  if (rows.length === 0) {
    return;
  }

  const sanitizedRows = rows.map((row) => ({
    ...row,
    data: sanitizeAnalyticsEventData(row.data),
  }));

  await getClickhouseAdminClient().insert({
    table: "analytics_internal.events",
    values: sanitizedRows,
    format: "JSONEachRow",
    clickhouse_settings: {
      date_time_input_format: "best_effort",
      async_insert: 1,
    },
  });

  for (const row of sanitizedRows) {
    exportAnalyticsEvent(row);
  }
}

/**
 * Extracts the end user IP info from the current request.
 * Must be called before any async operations as it uses dynamic APIs.
 */
export async function getEndUserIpInfoForEvent(): Promise<EndUserIpInfo | null> {
  const endUserInfo = await getEndUserInfo();
  if (!endUserInfo) {
    return null;
  }

  const info = endUserInfo.maybeSpoofed ? endUserInfo.spoofedInfo : endUserInfo.exactInfo;
  return {
    ip: info.ip,
    isTrusted: !endUserInfo.maybeSpoofed,
    countryCode: info.countryCode,
    regionCode: info.regionCode,
    cityName: info.cityName,
    latitude: info.latitude,
    longitude: info.longitude,
    tzIdentifier: info.tzIdentifier,
  };
}

type EventType = {
  id: string,
  dataSchema: yup.Schema<any>,
  // The event type that this event type inherits from. Use this if every one of the events is also another event and you want all the fields from it.
  inherits: EventType[],
};

type SystemEventTypeBase = EventType & {
  id: `$${string}`,
};

const LegacyApiEventType = {
  id: "$legacy-api",
  dataSchema: yupObject({}),
  inherits: [],
} as const satisfies SystemEventTypeBase;

const ProjectEventType = {
  id: "$project",
  dataSchema: yupObject({
    projectId: yupString().defined(),
  }),
  inherits: [],
} as const satisfies SystemEventTypeBase;

const ProjectActivityEventType = {
  id: "$project-activity",
  dataSchema: yupObject({}),
  inherits: [ProjectEventType],
} as const satisfies SystemEventTypeBase;

const UserActivityEventType = {
  id: "$user-activity",
  dataSchema: yupObject({
    // old events of this type may not have a branchId field, so we default to the default branch ID
    branchId: yupString().defined().default(DEFAULT_BRANCH_ID),
    userId: yupString().uuid().defined(),
    // old events of this type may not have an isAnonymous field, so we default to false
    isAnonymous: yupBoolean().defined().default(false),
    teamId: yupString().optional(),
  }),
  inherits: [ProjectActivityEventType],
} as const satisfies SystemEventTypeBase;

const SessionActivityEventType = {
  id: "$session-activity",
  dataSchema: yupObject({
    sessionId: yupString().defined(),
  }),
  inherits: [UserActivityEventType],
} as const satisfies SystemEventTypeBase;

const TokenRefreshEventType = {
  id: "$token-refresh",
  dataSchema: yupObject({
    refreshTokenId: yupString().defined(),
    ipInfo: endUserIpInfoSchema.nullable().defined(),
  }),
  inherits: [UserActivityEventType],
} as const satisfies SystemEventTypeBase;


const ApiRequestEventType = {
  id: "$api-request",
  dataSchema: yupObject({
    method: yupString().oneOf(typedKeys(HTTP_METHODS)).defined(),
    url: urlSchema.defined(),
    body: yupMixed().nullable().optional(),
    headers: yupObject().defined(),
  }),
  inherits: [
    ProjectEventType,
  ],
} as const satisfies SystemEventTypeBase;

const SignUpRuleTriggerEventType = {
  id: "$sign-up-rule-trigger",
  dataSchema: yupObject({
    projectId: yupString().defined(),
    branchId: yupString().defined(),
    ruleId: yupString().defined(),
    action: yupString().oneOf(['allow', 'reject', 'restrict', 'log']).defined(),
    email: yupString().nullable().defined(),
    authMethod: yupString().oneOf(['password', 'otp', 'oauth', 'passkey']).nullable().defined(),
    oauthProvider: yupString().nullable().defined(),
  }),
  inherits: [],
} as const satisfies SystemEventTypeBase;

export const SystemEventTypes = stripEventTypeSuffixFromKeys({
  ProjectEventType,
  ProjectActivityEventType,
  UserActivityEventType,
  SessionActivityEventType,
  TokenRefreshEventType,
  ApiRequestEventType,
  LegacyApiEventType,
  SignUpRuleTriggerEventType,
} as const);
const systemEventTypesById = new Map(Object.values(SystemEventTypes).map(eventType => [eventType.id, eventType]));
const clickhouseSystemEventTypeIds = new Set(["$token-refresh", "$sign-up-rule-trigger"]);

function stripEventTypeSuffixFromKeys<T extends Record<`${string}EventType`, unknown>>(t: T): { [K in keyof T as K extends `${infer Key}EventType` ? Key : never]: T[K] } {
  return Object.fromEntries(Object.entries(t).map(([key, value]) => [key.replace(/EventType$/, ""), value])) as any;
}

type DataOfMany<T extends EventType[]> = UnionToIntersection<T extends unknown ? DataOf<T[number]> : never>;  // distributive conditional. See: https://www.typescriptlang.org/docs/handbook/2/conditional-types.html#distributive-conditional-types

type DataOf<T extends EventType> =
  & yup.InferType<T["dataSchema"]>
  & DataOfMany<T["inherits"]>;

function getAnalyticsDataForLoggedEvent(eventTypeId: string, dataRecord: Record<string, unknown> | null | undefined): Record<string, unknown> {
  if (eventTypeId === "$token-refresh") {
    const refreshTokenId =
      typeof dataRecord === "object" && dataRecord && typeof dataRecord.refreshTokenId === "string"
        ? dataRecord.refreshTokenId
        : throwErr(new StackAssertionError("refreshTokenId is required for $token-refresh ClickHouse event", { dataRecord }));
    const isAnonymous =
      typeof dataRecord === "object" && dataRecord && typeof dataRecord.isAnonymous === "boolean"
        ? dataRecord.isAnonymous
        : throwErr(new StackAssertionError("isAnonymous is required for $token-refresh ClickHouse event", { dataRecord }));
    const ipInfo =
      typeof dataRecord === "object" && dataRecord
        ? (dataRecord.ipInfo as EndUserIpInfo | null | undefined)
        : undefined;
    return {
      refresh_token_id: refreshTokenId,
      is_anonymous: isAnonymous,
      ip_info: toClickhouseEndUserIpInfo(ipInfo ?? null),
    };
  }

  if (eventTypeId === "$sign-up-rule-trigger") {
    const ruleId =
      typeof dataRecord === "object" && dataRecord && typeof dataRecord.ruleId === "string"
        ? dataRecord.ruleId
        : throwErr(new StackAssertionError("ruleId is required for $sign-up-rule-trigger ClickHouse event", { dataRecord }));
    const action =
      typeof dataRecord === "object" && dataRecord && typeof dataRecord.action === "string"
        ? dataRecord.action
        : throwErr(new StackAssertionError("action is required for $sign-up-rule-trigger ClickHouse event", { dataRecord }));
    const email =
      typeof dataRecord === "object" && dataRecord
        ? (dataRecord.email as string | null | undefined) ?? null
        : null;
    const authMethod =
      typeof dataRecord === "object" && dataRecord
        ? (dataRecord.authMethod as string | null | undefined) ?? null
        : null;
    const oauthProvider =
      typeof dataRecord === "object" && dataRecord
        ? (dataRecord.oauthProvider as string | null | undefined) ?? null
        : null;
    return {
      rule_id: ruleId,
      action,
      email,
      auth_method: authMethod,
      oauth_provider: oauthProvider,
    };
  }

  if (dataRecord === null || dataRecord === undefined || Array.isArray(dataRecord)) {
    throw new StackAssertionError(
      `Analytics event data for ${eventTypeId} must be a JSON object`,
      { dataRecord },
    );
  }

  return dataRecord;
}

/**
 * Do not wrap this function in waitUntil or runAsynchronously as it may use dynamic APIs
 */
export async function logEvent<T extends EventType[]>(
  eventTypes: T,
  data: DataOfMany<T>,
  options: {
    time?: Date | { start: Date, end: Date },
    refreshTokenId?: string,
    sessionReplayId?: string,
    sessionReplaySegmentId?: string,
  } = {}
) {
  let timeOrTimeRange = options.time ?? new Date();
  const timeRange = "start" in timeOrTimeRange && "end" in timeOrTimeRange ? timeOrTimeRange : { start: timeOrTimeRange, end: timeOrTimeRange };
  const isWide = timeOrTimeRange === timeRange;

  // assert all event types are valid
  for (const eventType of eventTypes) {
    if (eventType.id.startsWith("$")) {
      if (!systemEventTypesById.has(eventType.id as any)) {
        throw new StackAssertionError(`Invalid system event type: ${eventType.id}`, { eventType });
      }
    }
  }


  // traverse and list all events in the inheritance chain
  const allEventTypes = new Set<EventType>();
  const addEventType = (eventType: EventType) => {
    if (allEventTypes.has(eventType)) {
      return;
    }
    allEventTypes.add(eventType);
    eventType.inherits.forEach(addEventType);
  };
  eventTypes.forEach(addEventType);


  // validate & transform data
  const originalData = data;
  for (const eventType of allEventTypes) {
    try {
      data = await eventType.dataSchema.validate(data, { strict: true, stripUnknown: false });
    } catch (error) {
      if (error instanceof yup.ValidationError) {
        throw new StackAssertionError(`Invalid event data for event type: ${eventType.id}`, { eventType, data, error, originalData, originalEventTypes: eventTypes, cause: error });
      }
      throw error;
    }
  }


  // get end user information
  const endUserInfo = await getEndUserInfo();  // this is a dynamic API, can't run it asynchronously
  const endUserInfoInner = endUserInfo?.maybeSpoofed ? endUserInfo.spoofedInfo : endUserInfo?.exactInfo;
  const eventTypesArray = [...allEventTypes];
  const dataRecord = data as Record<string, unknown> | null | undefined;
  const projectId =
    typeof dataRecord === "object" && dataRecord && typeof dataRecord.projectId === "string"
      ? dataRecord.projectId
      : "";
  const branchId =
    typeof dataRecord === "object" && dataRecord && typeof dataRecord.branchId === "string"
      ? dataRecord.branchId
      : DEFAULT_BRANCH_ID;
  const userId =
    typeof dataRecord === "object" && dataRecord && typeof dataRecord.userId === "string"
      ? dataRecord.userId
      : "";


  // rest is no more dynamic APIs so we can run it asynchronously
  runAsynchronouslyAndWaitUntil((async () => {
    // log event in DB
    await globalPrismaClient.event.create({
      data: {
        systemEventTypeIds: eventTypesArray
          .filter((eventType) => eventType.id.startsWith("$"))
          .map((eventType) => eventType.id),
        data: data as any,
        isEndUserIpInfoGuessTrusted: !endUserInfo?.maybeSpoofed,
        endUserIpInfoGuess: endUserInfoInner ? {
          create: {
            ip: endUserInfoInner.ip,
            countryCode: endUserInfoInner.countryCode,
            regionCode: endUserInfoInner.regionCode,
            cityName: endUserInfoInner.cityName,
            tzIdentifier: endUserInfoInner.tzIdentifier,
            latitude: endUserInfoInner.latitude,
            longitude: endUserInfoInner.longitude,
          },
        } : undefined,
        isWide,
        eventStartedAt: timeRange.start,
        eventEndedAt: timeRange.end,
      },
    });

    const analyticsRows = eventTypes
      .filter((eventType) => !eventType.id.startsWith("$") || clickhouseSystemEventTypeIds.has(eventType.id))
      .map((eventType) => {
        if (!projectId) {
          throw new StackAssertionError(
            `projectId is required for ClickHouse event insertion (${eventType.id})`,
            { eventType, dataRecord },
          );
        }

        const analyticsData = getAnalyticsDataForLoggedEvent(eventType.id, dataRecord);
        const resolvedRefreshTokenId = options.refreshTokenId
          ?? (eventType.id === "$token-refresh" && typeof analyticsData.refresh_token_id === "string"
            ? analyticsData.refresh_token_id
            : null);

        const sessionReplayId = options.sessionReplayId ?? null;
        const sessionReplaySegmentId = options.sessionReplaySegmentId ?? null;
        return {
          event_type: eventType.id,
          event_id: generateUuid(),
          trace_id: generateUuid(),
          event_at: timeRange.end,
          parent_span_ids: sessionReplaySegmentId ? [sessionReplaySegmentId] : [],
          data: analyticsData,
          project_id: projectId,
          branch_id: branchId,
          user_id: userId || null,
          team_id: null,
          refresh_token_id: resolvedRefreshTokenId ?? null,
          session_replay_id: sessionReplayId,
          session_replay_segment_id: options.sessionReplaySegmentId ?? null,
          from_server: true,
        } satisfies AnalyticsEventInsertRow;
      });

    if (analyticsRows.length > 0) {
      await insertAnalyticsEvents(analyticsRows);
    }

    // log event in PostHog
    if (getNodeEnvironment().includes("production") && !getEnvVariable("CI", "")) {
      await withPostHog(async posthog => {
        const distinctId = typeof data === "object" && data && "userId" in data ? (data.userId as string) : `backend-anon-${generateUuid()}`;
        for (const eventType of allEventTypes) {
          const postHogEventName = `stack_${eventType.id.replace(/^\$/, "system_").replace(/-/g, "_")}`;
          posthog.capture({
            event: postHogEventName,
            distinctId,
            groups: filterUndefined({
              projectId: typeof data === "object" && data && "projectId" in data ? (typeof data.projectId === "string" ? data.projectId : throwErr("Project ID is not a string for some reason?", { data })) : undefined,
            }),
            timestamp: timeRange.end,
            properties: {
              data,
              is_wide: isWide,
              event_started_at: timeRange.start,
              event_ended_at: timeRange.end,
            },
          });
        }
      });
    }
  })());
}
