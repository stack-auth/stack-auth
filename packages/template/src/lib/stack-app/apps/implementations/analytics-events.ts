import { AUTO_CAPTURED_ANALYTICS_EVENT_TYPES, type AnalyticsBatchEvent, type AnalyticsEventPayload } from "@stackframe/stack-shared/dist/interface/crud/analytics";
import { StackAssertionError } from "@stackframe/stack-shared/dist/utils/errors";

export type { AutoCapturedAnalyticsEventType } from "@stackframe/stack-shared/dist/interface/crud/analytics";

export type AnalyticsReplayLinkOptions = {
  sessionReplayId?: string | null,
  sessionReplaySegmentId?: string | null,
};

export const autoCapturedAnalyticsEventTypes = AUTO_CAPTURED_ANALYTICS_EVENT_TYPES;

const autoCapturedAnalyticsEventTypeSet = new Set<string>(AUTO_CAPTURED_ANALYTICS_EVENT_TYPES);

export function assertValidAnalyticsEventName(
  eventType: string,
  options: { allowAutoCapturedReservedType?: boolean } = {},
) {
  if (!eventType) {
    throw new StackAssertionError("Analytics event type must not be empty");
  }
  if (options.allowAutoCapturedReservedType && autoCapturedAnalyticsEventTypeSet.has(eventType)) {
    return;
  }
  if (eventType.startsWith("$")) {
    throw new StackAssertionError(`Custom analytics event types cannot start with "$": ${eventType}`);
  }
  if (!/^[A-Za-z0-9._:-]+$/.test(eventType)) {
    throw new StackAssertionError(`Invalid analytics event type: ${eventType}. Only letters, numbers, ".", "_", ":", and "-" are allowed.`);
  }
}

export function normalizeAnalyticsEventAt(at?: Date | number): number {
  const value = at instanceof Date ? at.getTime() : at ?? Date.now();
  if (!Number.isInteger(value) || value < 0) {
    throw new StackAssertionError(`Analytics event time must be a non-negative integer. Received: ${String(value)}`);
  }
  return value;
}

export function normalizeAnalyticsEventPayload(data?: unknown): AnalyticsEventPayload {
  if (data === undefined) return {};
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new StackAssertionError("Analytics event payload must be a JSON object.");
  }
  try {
    return JSON.parse(JSON.stringify(data)) as AnalyticsEventPayload;
  } catch (error) {
    throw new StackAssertionError("Analytics event payload must be JSON-serializable.", { cause: error, data });
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function normalizeAnalyticsReplayLinkOptions(options?: AnalyticsReplayLinkOptions): Pick<AnalyticsBatchEvent, "session_replay_id" | "session_replay_segment_id"> {
  if (options?.sessionReplayId != null && !UUID_RE.test(options.sessionReplayId)) {
    throw new StackAssertionError(`sessionReplayId must be a UUID, got: ${options.sessionReplayId}`);
  }
  if (options?.sessionReplaySegmentId != null && !UUID_RE.test(options.sessionReplaySegmentId)) {
    throw new StackAssertionError(`sessionReplaySegmentId must be a UUID, got: ${options.sessionReplaySegmentId}`);
  }
  return {
    ...(options?.sessionReplayId != null ? { session_replay_id: options.sessionReplayId } : {}),
    ...(options?.sessionReplaySegmentId != null ? { session_replay_segment_id: options.sessionReplaySegmentId } : {}),
  };
}
