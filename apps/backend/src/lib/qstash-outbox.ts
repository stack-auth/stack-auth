import { globalPrismaClient, type PrismaClientTransaction } from "@/prisma-client";
import {
  buildBackgroundJobEnvelope,
  buildBackgroundJobKey,
  type BackgroundJobEnvelope,
  type BackgroundJobType,
} from "./telemetry/contract";

export type QstashFlowControl = {
  key: string;
  parallelism: number;
};

export type QstashDelay = number | `${bigint}s` | `${bigint}m` | `${bigint}h` | `${bigint}d`;

export type QstashMessage<TPayload extends Record<string, unknown>> = {
  url: string;
  body: TPayload;
  flowControl?: QstashFlowControl;
  delay?: QstashDelay;
  job?: BackgroundJobEnvelope<Record<string, unknown>>;
};

export type QstashOutboxMessage<TPayload extends Record<string, unknown>> = {
  jobType: BackgroundJobType;
  tenancyId: string | null;
  deduplicationKey: string;
  message: QstashMessage<TPayload>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isQstashDelay(value: unknown): value is QstashDelay {
  if (typeof value === "number") return Number.isSafeInteger(value) && value >= 0;
  return typeof value === "string" && /^\d+[smhd]$/u.test(value);
}

function isBackgroundJobType(value: unknown): value is BackgroundJobType {
  if (typeof value !== "string") return false;
  switch (value) {
    case "external-db-sync": {
      return true;
    }
    case "telemetry-materialization": {
      return true;
    }
    default: {
      return false;
    }
  }
}

export function decodeBackgroundJobEnvelope(value: unknown): BackgroundJobEnvelope<Record<string, unknown>> {
  if (!isRecord(value)
    || value.schemaVersion !== 1
    || typeof value.jobId !== "string"
    || value.jobId.length === 0
    || !isBackgroundJobType(value.jobType)
    || !(value.tenancyId === null || typeof value.tenancyId === "string")
    || typeof value.deduplicationKey !== "string"
    || value.deduplicationKey.length === 0
    || !isRecord(value.payload)) {
    throw new Error("OutgoingRequest qstashOptions.job is invalid");
  }
  return {
    schemaVersion: 1,
    jobId: value.jobId,
    jobType: value.jobType,
    tenancyId: value.tenancyId,
    deduplicationKey: value.deduplicationKey,
    payload: value.payload,
  };
}

function assertMessage(message: QstashMessage<Record<string, unknown>>): void {
  if (!/^\/(?![\\/])/u.test(message.url)) throw new Error("QStash outbox URLs must be internal relative paths");
  if (message.flowControl !== undefined) {
    if (!/^[a-zA-Z0-9._-]+$/.test(message.flowControl.key)) {
      throw new Error("QStash flow-control keys must be non-empty and contain only alphanumerics, hyphens, underscores, or periods");
    }
    if (!Number.isSafeInteger(message.flowControl.parallelism) || message.flowControl.parallelism < 1) {
      throw new Error("QStash flow-control parallelism must be a positive integer");
    }
  }
  if (message.delay !== undefined && !isQstashDelay(message.delay)) {
    throw new Error("QStash delays must not be empty");
  }
}

export function decodeQstashMessage(value: unknown): QstashMessage<Record<string, unknown>> {
  if (!isRecord(value)) throw new Error("OutgoingRequest qstashOptions must be a JSON object");

  const url = value.url;
  if (typeof url !== "string" || url.length === 0) {
    throw new Error("OutgoingRequest qstashOptions.url must be a non-empty string");
  }

  const body = value.body === undefined ? {} : value.body;
  if (!isRecord(body)) throw new Error("OutgoingRequest qstashOptions.body must be a JSON object");
  const job = value.job === undefined ? undefined : decodeBackgroundJobEnvelope(value.job);

  let flowControl: QstashFlowControl | undefined;
  if (value.flowControl !== undefined) {
    if (!isRecord(value.flowControl)
      || typeof value.flowControl.key !== "string"
      || typeof value.flowControl.parallelism !== "number") {
      throw new Error("OutgoingRequest qstashOptions.flowControl is invalid");
    }
    flowControl = {
      key: value.flowControl.key,
      parallelism: value.flowControl.parallelism,
    };
  }

  let delay: QstashDelay | undefined;
  if (value.delay !== undefined) {
    if (!isQstashDelay(value.delay)) {
      throw new Error("OutgoingRequest qstashOptions.delay is invalid");
    }
    delay = value.delay;
  }

  const message: QstashMessage<Record<string, unknown>> = {
    url,
    body,
    ...(flowControl === undefined ? {} : { flowControl }),
    ...(delay === undefined ? {} : { delay }),
    ...(job === undefined ? {} : { job }),
  };
  assertMessage(message);
  return message;
}

export async function enqueueQstashMessage<TPayload extends Record<string, unknown>>(
  options: QstashOutboxMessage<TPayload>,
  client: PrismaClientTransaction = globalPrismaClient,
): Promise<void> {
  assertMessage(options.message);
  if (options.deduplicationKey.length === 0) throw new Error("QStash outbox deduplication keys must not be empty");
  const job = buildBackgroundJobEnvelope({
    jobType: options.jobType,
    jobId: options.deduplicationKey,
    tenancyId: options.tenancyId,
    deduplicationKey: options.deduplicationKey,
    payload: options.message.body,
  });

  await client.$executeRaw`
    INSERT INTO "OutgoingRequest" ("id", "createdAt", "qstashOptions", "startedFulfillingAt", "deduplicationKey")
    VALUES (
      gen_random_uuid(),
      NOW(),
      ${JSON.stringify({
        url: options.message.url,
        body: options.message.body,
        job,
        ...(options.message.flowControl === undefined ? {} : { flowControl: options.message.flowControl }),
        ...(options.message.delay === undefined ? {} : { delay: options.message.delay }),
      })}::jsonb,
      NULL,
      ${options.deduplicationKey}
    )
    ON CONFLICT ("deduplicationKey") WHERE "startedFulfillingAt" IS NULL DO NOTHING
  `;
}

export function buildTelemetryMaterializationMessage(options: {
  tenancyId: string;
  batchId: string;
  apiPath?: string;
}): QstashOutboxMessage<{ tenancyId: string, batchId: string }> {
  const deduplicationKey = buildBackgroundJobKey(
    "telemetry-materialization",
    { tenancyId: options.tenancyId },
    options.batchId,
  );
  return {
    jobType: "telemetry-materialization",
    tenancyId: options.tenancyId,
    deduplicationKey,
    message: {
      url: options.apiPath ?? "/api/latest/internal/telemetry/materialize",
      body: {
        tenancyId: options.tenancyId,
        batchId: options.batchId,
      },
      flowControl: {
        key: `telemetry-materialization.${options.tenancyId}`,
        parallelism: 4,
      },
      delay: "5s",
    },
  };
}
