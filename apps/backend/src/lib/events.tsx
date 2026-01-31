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
    teamId: yupString().optional().default(""),
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
    projectId: yupString().defined(),
    branchId: yupString().defined(),
    organizationId: yupString().nullable().test("must-be-null", "Organization ID has not been implemented yet and must be null", (value) => value === null).defined(),
    userId: yupString().uuid().defined(),
    refreshTokenId: yupString().defined(),
    isAnonymous: yupBoolean().defined(),
    ipInfo: endUserIpInfoSchema.nullable().defined(),
  }),
  inherits: [],
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
    userId: yupString().uuid().nullable().defined(),
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

function stripEventTypeSuffixFromKeys<T extends Record<`${string}EventType`, unknown>>(t: T): { [K in keyof T as K extends `${infer Key}EventType` ? Key : never]: T[K] } {
  return Object.fromEntries(Object.entries(t).map(([key, value]) => [key.replace(/EventType$/, ""), value])) as any;
}

type DataOfMany<T extends EventType[]> = UnionToIntersection<T extends unknown ? DataOf<T[number]> : never>;  // distributive conditional. See: https://www.typescriptlang.org/docs/handbook/2/conditional-types.html#distributive-conditional-types

type DataOf<T extends EventType> =
  & yup.InferType<T["dataSchema"]>
  & DataOfMany<T["inherits"]>;

/**
 * Do not wrap this function in waitUntil or runAsynchronously as it may use dynamic APIs
 */
export async function logEvent<T extends EventType[]>(
  eventTypes: T,
  data: DataOfMany<T>,
  options: {
    time?: Date | { start: Date, end: Date },
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
    } else {
      throw new StackAssertionError(`Non-system event types are not supported yet`, { eventType });
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
  const clickhouseEventData = {
    ...data as Record<string, unknown>,
  };
  const dataRecord = data as Record<string, unknown> | null | undefined;
  const projectId = typeof dataRecord === "object" && dataRecord && typeof dataRecord.projectId === "string" ? dataRecord.projectId : "";
  const branchId = typeof dataRecord === "object" && dataRecord && typeof dataRecord.branchId === "string" ? dataRecord.branchId : DEFAULT_BRANCH_ID;
  const userId = typeof dataRecord === "object" && dataRecord && typeof dataRecord.userId === "string" ? dataRecord.userId : "";


  // rest is no more dynamic APIs so we can run it asynchronously
  runAsynchronouslyAndWaitUntil((async () => {
    // log event in DB
    await globalPrismaClient.event.create({
      data: {
        systemEventTypeIds: eventTypesArray.map(eventType => eventType.id),
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

    // Log specific events to ClickHouse
    const clickhouseEventTypes = ['$token-refresh', '$sign-up-rule-trigger'];
    const matchingEventType = eventTypesArray.find(e => clickhouseEventTypes.includes(e.id));
    if (matchingEventType) {
      const clickhouseClient = getClickhouseAdminClient();
      await clickhouseClient.insert({
        table: "analytics_internal.events",
        values: [{
          event_type: matchingEventType.id,
          event_at: timeRange.end,
          data: clickhouseEventData,
          project_id: projectId,
          branch_id: branchId,
          user_id: userId || null,
          team_id: null,
        }],
        format: "JSONEachRow",
        clickhouse_settings: {
          date_time_input_format: "best_effort",
          async_insert: 1,
        },
      });
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
