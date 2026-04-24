import { Prisma } from "@/generated/prisma/client";
import {
  conversationMessageTypeValues,
  conversationPriorityValues,
  conversationSenderSchema,
  conversationSenderTypeValues,
  conversationSourceValues,
  conversationStatusValues,
  type ConversationDetailResponse,
  type ConversationEntryPoint,
  type ConversationMessage,
  type ConversationMessageType,
  type ConversationMetadata,
  type ConversationPriority,
  type ConversationSender,
  type ConversationSource,
  type ConversationStatus,
  type ConversationSummary,
} from "@/lib/conversation-types";
import { listManagedProjectIds } from "@/lib/projects";
import { DEFAULT_BRANCH_ID, getSoleTenancyFromProjectBranch, getTenancy } from "@/lib/tenancies";
import { globalPrismaClient, retryTransaction, type PrismaClientTransaction } from "@/prisma-client";
import { KnownErrors } from "@stackframe/stack-shared";
import { computeFirstResponseDueAt, computeNextResponseDueAt, resolveSupportSla, type SupportSlaConfig } from "@stackframe/stack-shared/dist/helpers/support-sla";
import { UsersCrud } from "@stackframe/stack-shared/dist/interface/crud/users";
import { yupArray, yupMixed, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { StackAssertionError, StatusError, throwErr } from "@stackframe/stack-shared/dist/utils/errors";
import { generateUuid } from "@stackframe/stack-shared/dist/utils/uuids";

const tagsSchema = yupArray(yupString().defined()).defined();
const attachmentsSchema = yupArray(yupMixed().defined()).defined();

type DbConversationRow = {
  conversationId: string,
  userId: string | null,
  teamId: string | null,
  subject: string,
  status: string,
  priority: string,
  source: string,
  createdAt: Date,
  updatedAt: Date,
  lastMessageAt: Date,
  lastInboundAt: Date | null,
  lastOutboundAt: Date | null,
  closedAt: Date | null,
  recordMetadata: Prisma.JsonValue | null,
  userDisplayName: string | null,
  userPrimaryEmail: string | null,
  userProfileImageUrl: string | null,
  assignedToUserId: string | null,
  assignedToDisplayName: string | null,
  tags: Prisma.JsonValue | null,
  firstResponseDueAt: Date | null,
  firstResponseAt: Date | null,
  nextResponseDueAt: Date | null,
  lastCustomerReplyAt: Date | null,
  lastAgentReplyAt: Date | null,
};

type ConversationEntryPointRow = {
  id: string,
  channelType: string,
  adapterKey: string,
  externalChannelId: string | null,
  isEntryPoint: boolean,
  metadata: Prisma.JsonValue | null,
  createdAt: Date,
  updatedAt: Date,
};

type ConversationSummaryRow = DbConversationRow & {
  latestMessageType: string | null,
  latestBody: string | null,
  lastVisibleActivityAt: Date | null,
};

type ConversationMessageRow = {
  id: string,
  messageType: string,
  senderType: string,
  senderId: string | null,
  senderDisplayName: string | null,
  senderPrimaryEmail: string | null,
  body: string | null,
  attachments: Prisma.JsonValue | null,
  metadata: Prisma.JsonValue | null,
  createdAt: Date,
};

type ConversationStateRow = {
  conversationId: string,
  userId: string | null,
  teamId: string | null,
  subject: string,
  status: string,
  priority: string,
  source: string,
  firstResponseAt: Date | null,
  lastCustomerReplyAt: Date | null,
  lastAgentReplyAt: Date | null,
};

function parseEnumValue<const T extends readonly string[]>(
  values: T,
  value: string,
  errorContext: string,
): T[number] {
  if (values.includes(value)) {
    return value;
  }
  throw new Error(`Unexpected ${errorContext}: ${value}`);
}

function parseSender(sender: ConversationSender) {
  return conversationSenderSchema.validateSync(sender);
}

function parseTags(value: Prisma.JsonValue | null): string[] {
  if (value == null) {
    return [];
  }
  return tagsSchema.validateSync(value);
}

function parseAttachments(value: Prisma.JsonValue | null): ConversationMessage["attachments"] {
  if (value == null) {
    return [];
  }
  return attachmentsSchema.validateSync(value);
}

function toIsoString(value: Date | null): string | null {
  return value?.toISOString() ?? null;
}

function conversationAttributesFromRow(row: DbConversationRow): ConversationMetadata {
  return {
    assignedToUserId: row.assignedToUserId,
    assignedToDisplayName: row.assignedToDisplayName,
    tags: parseTags(row.tags),
    firstResponseDueAt: toIsoString(row.firstResponseDueAt),
    firstResponseAt: toIsoString(row.firstResponseAt),
    nextResponseDueAt: toIsoString(row.nextResponseDueAt),
    lastCustomerReplyAt: toIsoString(row.lastCustomerReplyAt),
    lastAgentReplyAt: toIsoString(row.lastAgentReplyAt),
  };
}

function previewForSummary(row: Pick<ConversationSummaryRow, "latestBody" | "latestMessageType" | "status">): string | null {
  if (row.latestBody != null && row.latestBody.trim() !== "") {
    return row.latestBody.trim();
  }

  const messageType = row.latestMessageType == null
    ? "message"
    : parseEnumValue(conversationMessageTypeValues, row.latestMessageType, "conversation message type");
  const status = parseEnumValue(conversationStatusValues, row.status, "conversation status");

  if (messageType === "status-change") {
    if (status === "closed") return "Conversation closed";
    if (status === "open") return "Conversation reopened";
    return "Conversation moved to pending";
  }
  if (messageType === "internal-note") {
    return "Internal note";
  }
  return null;
}

function summaryFromRow(row: ConversationSummaryRow): ConversationSummary {
  return {
    conversationId: row.conversationId,
    userId: row.userId,
    teamId: row.teamId,
    userDisplayName: row.userDisplayName,
    userPrimaryEmail: row.userPrimaryEmail,
    userProfileImageUrl: row.userProfileImageUrl,
    subject: row.subject,
    status: parseEnumValue(conversationStatusValues, row.status, "conversation status"),
    priority: parseEnumValue(conversationPriorityValues, row.priority, "conversation priority"),
    source: parseEnumValue(conversationSourceValues, row.source, "conversation source"),
    lastMessageType: parseEnumValue(
      conversationMessageTypeValues,
      row.latestMessageType ?? "message",
      "conversation message type",
    ),
    preview: previewForSummary(row),
    lastActivityAt: (row.lastVisibleActivityAt ?? row.createdAt).toISOString(),
    metadata: conversationAttributesFromRow(row),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    lastMessageAt: row.lastMessageAt.toISOString(),
    lastInboundAt: toIsoString(row.lastInboundAt),
    lastOutboundAt: toIsoString(row.lastOutboundAt),
    closedAt: toIsoString(row.closedAt),
    recordMetadata: row.recordMetadata ?? null,
  };
}

function entryPointFromRow(row: ConversationEntryPointRow): ConversationEntryPoint {
  return {
    id: row.id,
    channelType: row.channelType,
    adapterKey: row.adapterKey,
    externalChannelId: row.externalChannelId,
    isEntryPoint: row.isEntryPoint,
    metadata: row.metadata,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function messageFromRow(row: ConversationMessageRow, conversation: DbConversationRow): ConversationMessage {
  return {
    id: row.id,
    conversationId: conversation.conversationId,
    userId: conversation.userId,
    teamId: conversation.teamId,
    subject: conversation.subject,
    status: parseEnumValue(conversationStatusValues, conversation.status, "conversation status"),
    priority: parseEnumValue(conversationPriorityValues, conversation.priority, "conversation priority"),
    source: parseEnumValue(conversationSourceValues, conversation.source, "conversation source"),
    messageType: parseEnumValue(conversationMessageTypeValues, row.messageType, "conversation message type"),
    body: row.body,
    attachments: parseAttachments(row.attachments),
    metadata: row.metadata,
    createdAt: row.createdAt.toISOString(),
    sender: {
      type: parseEnumValue(conversationSenderTypeValues, row.senderType, "conversation sender type"),
      id: row.senderId,
      displayName: row.senderDisplayName,
      primaryEmail: row.senderPrimaryEmail,
    },
  };
}

function jsonbParam(value: unknown) {
  return Prisma.sql`CAST(${JSON.stringify(value)} AS jsonb)`;
}

async function getConversationRow(options: {
  tenancyId: string,
  conversationId: string,
  viewerProjectUserId?: string,
}) {
  const rows = await globalPrismaClient.$queryRaw<DbConversationRow[]>(Prisma.sql`
    SELECT
      c.id AS "conversationId",
      c."projectUserId" AS "userId",
      c."teamId" AS "teamId",
      c.subject,
      c.status,
      c.priority,
      c.source,
      c."createdAt",
      c."updatedAt",
      c."lastMessageAt",
      c."lastInboundAt",
      c."lastOutboundAt",
      c."closedAt",
      c.metadata AS "recordMetadata",
      pu."displayName" AS "userDisplayName",
      pu."profileImageUrl" AS "userProfileImageUrl",
      cc."value" AS "userPrimaryEmail",
      c."assignedToUserId",
      c."assignedToDisplayName",
      c.tags,
      c."firstResponseDueAt",
      c."firstResponseAt",
      c."nextResponseDueAt",
      c."lastCustomerReplyAt",
      c."lastAgentReplyAt"
    FROM "Conversation" c
    LEFT JOIN "ProjectUser" pu
      ON pu."tenancyId" = c."tenancyId"
      AND pu."projectUserId" = c."projectUserId"
    LEFT JOIN "ContactChannel" cc
      ON cc."tenancyId" = c."tenancyId"
      AND cc."projectUserId" = c."projectUserId"
      AND cc."type" = 'EMAIL'
      AND cc."isPrimary" = 'TRUE'
    WHERE c."tenancyId" = ${options.tenancyId}::uuid
      AND c.id = ${options.conversationId}::uuid
      ${options.viewerProjectUserId != null ? Prisma.sql`AND c."projectUserId" = ${options.viewerProjectUserId}::uuid` : Prisma.empty}
    LIMIT 1
  `);

  return rows.at(0) ?? null;
}

async function getConversationState(options: {
  tenancyId: string,
  conversationId: string,
  viewerProjectUserId?: string,
}) {
  const rows = await globalPrismaClient.$queryRaw<ConversationStateRow[]>(Prisma.sql`
    SELECT
      c.id AS "conversationId",
      c."projectUserId" AS "userId",
      c."teamId" AS "teamId",
      c.subject,
      c.status,
      c.priority,
      c.source,
      c."firstResponseAt",
      c."lastCustomerReplyAt",
      c."lastAgentReplyAt"
    FROM "Conversation" c
    WHERE c."tenancyId" = ${options.tenancyId}::uuid
      AND c.id = ${options.conversationId}::uuid
      ${options.viewerProjectUserId != null ? Prisma.sql`AND c."projectUserId" = ${options.viewerProjectUserId}::uuid` : Prisma.empty}
    LIMIT 1
  `);

  const row = rows.at(0);
  if (row == null) {
    throw new StatusError(404, "Conversation not found.");
  }

  return {
    conversationId: row.conversationId,
    userId: row.userId,
    teamId: row.teamId,
    subject: row.subject,
    status: parseEnumValue(conversationStatusValues, row.status, "conversation status"),
    priority: parseEnumValue(conversationPriorityValues, row.priority, "conversation priority"),
    source: parseEnumValue(conversationSourceValues, row.source, "conversation source"),
    firstResponseAt: row.firstResponseAt,
    lastCustomerReplyAt: row.lastCustomerReplyAt,
    lastAgentReplyAt: row.lastAgentReplyAt,
  };
}

async function ensureConversationEntryPoint(options: {
  tx: PrismaClientTransaction,
  tenancyId: string,
  conversationId: string,
  channelType: ConversationSource,
  adapterKey: string,
  isEntryPoint: boolean,
}) {
  const existingRows = await options.tx.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT id
    FROM "ConversationEntryPoint"
    WHERE "tenancyId" = ${options.tenancyId}::uuid
      AND "conversationId" = ${options.conversationId}::uuid
      AND "channelType" = ${options.channelType}
      AND "adapterKey" = ${options.adapterKey}
      AND "externalChannelId" IS NULL
    ORDER BY "createdAt" ASC
    LIMIT 1
  `);

  const existingRow = existingRows.at(0);
  if (existingRow != null) {
    return existingRow.id;
  }

  const entryPointId = generateUuid();
  await options.tx.$executeRaw(Prisma.sql`
    INSERT INTO "ConversationEntryPoint" (
      id,
      "tenancyId",
      "conversationId",
      "channelType",
      "adapterKey",
      "externalChannelId",
      "isEntryPoint",
      metadata,
      "createdAt",
      "updatedAt"
    )
    VALUES (
      ${entryPointId}::uuid,
      ${options.tenancyId}::uuid,
      ${options.conversationId}::uuid,
      ${options.channelType},
      ${options.adapterKey},
      NULL,
      ${options.isEntryPoint},
      NULL,
      NOW(),
      NOW()
    )
  `);
  return entryPointId;
}

export async function getManagedProjectTenancy(projectId: string, user: UsersCrud["Admin"]["Read"]) {
  const managedProjectIds = await listManagedProjectIds(user);
  if (!managedProjectIds.includes(projectId)) {
    throw new KnownErrors.ProjectNotFound(projectId);
  }
  return await getSoleTenancyFromProjectBranch(projectId, DEFAULT_BRANCH_ID);
}

export async function listConversationSummaries(options: {
  tenancyId: string,
  status?: ConversationStatus,
  query?: string,
  userId?: string,
  includeInternalNotes: boolean,
}) {
  const searchPattern = options.query == null || options.query.trim() === ""
    ? null
    : `%${options.query.trim().toLowerCase()}%`;

  const rows = await globalPrismaClient.$queryRaw<ConversationSummaryRow[]>(Prisma.sql`
    SELECT
      c.id AS "conversationId",
      c."projectUserId" AS "userId",
      c."teamId" AS "teamId",
      c.subject,
      c.status,
      c.priority,
      c.source,
      c."createdAt",
      c."updatedAt",
      c."lastMessageAt",
      c."lastInboundAt",
      c."lastOutboundAt",
      c."closedAt",
      c.metadata AS "recordMetadata",
      pu."displayName" AS "userDisplayName",
      pu."profileImageUrl" AS "userProfileImageUrl",
      cc."value" AS "userPrimaryEmail",
      c."assignedToUserId",
      c."assignedToDisplayName",
      c.tags,
      c."firstResponseDueAt",
      c."firstResponseAt",
      c."nextResponseDueAt",
      c."lastCustomerReplyAt",
      c."lastAgentReplyAt",
      lm."messageType" AS "latestMessageType",
      lm.body AS "latestBody",
      lm."createdAt" AS "lastVisibleActivityAt"
    FROM "Conversation" c
    LEFT JOIN "ProjectUser" pu
      ON pu."tenancyId" = c."tenancyId"
      AND pu."projectUserId" = c."projectUserId"
    LEFT JOIN "ContactChannel" cc
      ON cc."tenancyId" = c."tenancyId"
      AND cc."projectUserId" = c."projectUserId"
      AND cc."type" = 'EMAIL'
      AND cc."isPrimary" = 'TRUE'
    LEFT JOIN LATERAL (
      SELECT
        cm."messageType",
        cm.body,
        cm."createdAt"
      FROM "ConversationMessage" cm
      WHERE cm."tenancyId" = c."tenancyId"
        AND cm."conversationId" = c.id
        ${options.includeInternalNotes ? Prisma.empty : Prisma.sql`AND cm."messageType" != 'internal-note'`}
      ORDER BY cm."createdAt" DESC, cm.id DESC
      LIMIT 1
    ) lm ON TRUE
    WHERE c."tenancyId" = ${options.tenancyId}::uuid
      ${options.userId != null ? Prisma.sql`AND c."projectUserId" = ${options.userId}::uuid` : Prisma.empty}
      ${options.status != null ? Prisma.sql`AND c.status = ${options.status}` : Prisma.empty}
      ${searchPattern != null ? Prisma.sql`
        AND (
          LOWER(c.subject) LIKE ${searchPattern}
          OR LOWER(COALESCE(lm.body, '')) LIKE ${searchPattern}
          OR LOWER(COALESCE(pu."displayName", '')) LIKE ${searchPattern}
          OR LOWER(COALESCE(cc."value", '')) LIKE ${searchPattern}
        )
      ` : Prisma.empty}
    ORDER BY COALESCE(lm."createdAt", c."createdAt") DESC, c.id DESC
    LIMIT 200
  `);

  return rows.map(summaryFromRow);
}

export async function getConversationDetail(options: {
  tenancyId: string,
  conversationId: string,
  includeInternalNotes: boolean,
  viewerProjectUserId?: string,
}): Promise<ConversationDetailResponse> {
  const conversation = await getConversationRow(options);
  if (conversation == null) {
    throw new StatusError(404, "Conversation not found.");
  }

  const messageRows = await globalPrismaClient.$queryRaw<ConversationMessageRow[]>(Prisma.sql`
    SELECT
      cm.id,
      cm."messageType",
      cm."senderType",
      cm."senderId",
      cm."senderDisplayName",
      cm."senderPrimaryEmail",
      cm.body,
      cm.attachments,
      cm.metadata,
      cm."createdAt"
    FROM "ConversationMessage" cm
    WHERE cm."tenancyId" = ${options.tenancyId}::uuid
      AND cm."conversationId" = ${options.conversationId}::uuid
      ${options.includeInternalNotes ? Prisma.empty : Prisma.sql`AND cm."messageType" != 'internal-note'`}
    ORDER BY cm."createdAt" ASC, cm.id ASC
  `);

  if (messageRows.length === 0) {
    throw new StatusError(404, "Conversation not found.");
  }

  const messages = messageRows.map((row) => messageFromRow(row, conversation));
  const latestMessage = messages.at(-1) ?? throwErr("Conversations must contain at least one message");

  const entryPointRows = await globalPrismaClient.$queryRaw<ConversationEntryPointRow[]>(Prisma.sql`
    SELECT
      cep.id,
      cep."channelType",
      cep."adapterKey",
      cep."externalChannelId",
      cep."isEntryPoint",
      cep.metadata,
      cep."createdAt",
      cep."updatedAt"
    FROM "ConversationEntryPoint" cep
    WHERE cep."tenancyId" = ${options.tenancyId}::uuid
      AND cep."conversationId" = ${options.conversationId}::uuid
    ORDER BY cep."createdAt" ASC, cep.id ASC
  `);

  return {
    conversation: summaryFromRow({
      ...conversation,
      latestMessageType: latestMessage.messageType,
      latestBody: latestMessage.body,
      lastVisibleActivityAt: new Date(latestMessage.createdAt),
    }),
    messages,
    entryPoints: entryPointRows.map(entryPointFromRow),
  };
}

async function loadSupportSlaConfig(tenancyId: string): Promise<SupportSlaConfig> {
  const tenancy = await getTenancy(tenancyId);
  if (tenancy == null) {
    throw new StackAssertionError(`Tenancy ${tenancyId} not found when loading support SLA config`);
  }
  return resolveSupportSla(tenancy.config.support);
}

export async function createConversation(options: {
  tenancyId: string,
  userId: string | null,
  teamId?: string | null,
  subject: string,
  priority: ConversationPriority,
  source: ConversationSource,
  channelType: ConversationSource,
  adapterKey: string,
  body: string,
  sender: ConversationSender,
  attachments?: unknown[],
}) {
  const sender = parseSender(options.sender);
  const now = new Date();
  const conversationId = generateUuid();
  const messageId = generateUuid();
  const channelId = generateUuid();

  const isUserMessage = sender.type === "user";
  const isAgentMessage = sender.type === "agent";

  const sla = await loadSupportSlaConfig(options.tenancyId);
  const firstResponseDueAt = isUserMessage
    ? computeFirstResponseDueAt(now, sla)
    : null;

  await retryTransaction(globalPrismaClient, async (tx) => {
    await tx.$executeRaw(Prisma.sql`
      INSERT INTO "Conversation" (
        id,
        "tenancyId",
        "projectUserId",
        "teamId",
        subject,
        status,
        priority,
        source,
        "assignedToUserId",
        "assignedToDisplayName",
        tags,
        "firstResponseDueAt",
        "firstResponseAt",
        "nextResponseDueAt",
        "lastCustomerReplyAt",
        "lastAgentReplyAt",
        metadata,
        "createdAt",
        "updatedAt",
        "lastMessageAt",
        "lastInboundAt",
        "lastOutboundAt",
        "closedAt"
      )
      VALUES (
        ${conversationId}::uuid,
        ${options.tenancyId}::uuid,
        ${options.userId}::uuid,
        ${options.teamId ?? null}::uuid,
        ${options.subject},
        'open',
        ${options.priority},
        ${options.source},
        NULL,
        NULL,
        ${jsonbParam([])},
        ${firstResponseDueAt == null ? Prisma.sql`NULL` : Prisma.sql`${firstResponseDueAt}`},
        NULL,
        NULL,
        ${isUserMessage ? Prisma.sql`${now}` : Prisma.sql`NULL`},
        ${isAgentMessage ? Prisma.sql`${now}` : Prisma.sql`NULL`},
        NULL,
        ${now},
        ${now},
        ${now},
        ${isUserMessage ? Prisma.sql`${now}` : Prisma.sql`NULL`},
        ${isAgentMessage ? Prisma.sql`${now}` : Prisma.sql`NULL`},
        NULL
      )
    `);

    await tx.$executeRaw(Prisma.sql`
      INSERT INTO "ConversationEntryPoint" (
        id,
        "tenancyId",
        "conversationId",
        "channelType",
        "adapterKey",
        "externalChannelId",
        "isEntryPoint",
        metadata,
        "createdAt",
        "updatedAt"
      )
      VALUES (
        ${channelId}::uuid,
        ${options.tenancyId}::uuid,
        ${conversationId}::uuid,
        ${options.channelType},
        ${options.adapterKey},
        NULL,
        TRUE,
        NULL,
        ${now},
        ${now}
      )
    `);

    await tx.$executeRaw(Prisma.sql`
      INSERT INTO "ConversationMessage" (
        id,
        "tenancyId",
        "conversationId",
        "channelId",
        "messageType",
        "senderType",
        "senderId",
        "senderDisplayName",
        "senderPrimaryEmail",
        body,
        attachments,
        metadata,
        "createdAt"
      )
      VALUES (
        ${messageId}::uuid,
        ${options.tenancyId}::uuid,
        ${conversationId}::uuid,
        ${channelId}::uuid,
        'message',
        ${sender.type},
        ${sender.id},
        ${sender.displayName},
        ${sender.primaryEmail},
        ${options.body},
        ${jsonbParam(options.attachments ?? [])},
        NULL,
        ${now}
      )
    `);
  });

  return {
    conversationId,
  };
}

/**
 * User-visible messages (`message` type) bump workflow status so the inbox matches who should act next:
 * agent reply on `open` → `pending` (waiting on user); user reply on `pending` → `open` (needs support).
 * Internal notes and explicit status changes are handled elsewhere; `closed` is left unchanged here.
 */
export function nextConversationStatusAfterAppend(options: {
  messageType: Extract<ConversationMessageType, "message" | "internal-note">,
  senderType: ConversationSender["type"],
  currentStatus: ConversationStatus,
}): ConversationStatus | null {
  if (options.messageType !== "message") {
    return null;
  }
  if (options.senderType === "agent" && options.currentStatus === "open") {
    return "pending";
  }
  if (options.senderType === "user" && options.currentStatus === "pending") {
    return "open";
  }
  return null;
}

export async function appendConversationMessage(options: {
  tenancyId: string,
  conversationId: string,
  messageType: Extract<ConversationMessageType, "message" | "internal-note">,
  body: string,
  sender: ConversationSender,
  viewerProjectUserId?: string,
  channelType?: ConversationSource,
  adapterKey?: string,
  attachments?: unknown[],
  metadata?: unknown | null,
}) {
  const sender = parseSender(options.sender);
  const conversation = await getConversationState({
    tenancyId: options.tenancyId,
    conversationId: options.conversationId,
    viewerProjectUserId: options.viewerProjectUserId,
  });

  const now = new Date();
  const messageId = generateUuid();
  const shouldTrackReplies = options.messageType === "message";
  const nextFirstResponseAt = (
    shouldTrackReplies
    && sender.type === "agent"
    && conversation.firstResponseAt == null
    && conversation.lastCustomerReplyAt != null
  ) ? now : conversation.firstResponseAt;

  const autoStatus = nextConversationStatusAfterAppend({
    messageType: options.messageType,
    senderType: sender.type,
    currentStatus: conversation.status,
  });

  const sla = await loadSupportSlaConfig(options.tenancyId);
  const shouldSetNextResponseDueAt = shouldTrackReplies && sender.type === "user" && autoStatus === "open";
  const shouldClearNextResponseDueAt = shouldTrackReplies && sender.type === "agent";
  const nextResponseDueAt = shouldSetNextResponseDueAt
    ? computeNextResponseDueAt(now, sla)
    : null;

  await retryTransaction(globalPrismaClient, async (tx) => {
    const channelId = (
      options.messageType === "message"
      && options.channelType != null
      && options.adapterKey != null
    )
      ? await ensureConversationEntryPoint({
        tx,
        tenancyId: options.tenancyId,
        conversationId: options.conversationId,
        channelType: options.channelType,
        adapterKey: options.adapterKey,
        isEntryPoint: false,
      })
      : null;

    await tx.$executeRaw(Prisma.sql`
      INSERT INTO "ConversationMessage" (
        id,
        "tenancyId",
        "conversationId",
        "channelId",
        "messageType",
        "senderType",
        "senderId",
        "senderDisplayName",
        "senderPrimaryEmail",
        body,
        attachments,
        metadata,
        "createdAt"
      )
      VALUES (
        ${messageId}::uuid,
        ${options.tenancyId}::uuid,
        ${options.conversationId}::uuid,
        ${channelId}::uuid,
        ${options.messageType},
        ${sender.type},
        ${sender.id},
        ${sender.displayName},
        ${sender.primaryEmail},
        ${options.body},
        ${jsonbParam(options.attachments ?? [])},
        ${options.metadata == null ? Prisma.sql`NULL` : jsonbParam(options.metadata)},
        ${now}
      )
    `);

    const conversationSetParts: Prisma.Sql[] = [];
    if (autoStatus != null) {
      conversationSetParts.push(Prisma.sql`status = ${autoStatus}`);
    }
    conversationSetParts.push(
      Prisma.sql`"updatedAt" = ${now}`,
      Prisma.sql`"lastMessageAt" = ${now}`,
      Prisma.sql`"lastInboundAt" = ${shouldTrackReplies && sender.type === "user" ? Prisma.sql`${now}` : Prisma.sql`"lastInboundAt"`}`,
      Prisma.sql`"lastOutboundAt" = ${shouldTrackReplies && sender.type === "agent" ? Prisma.sql`${now}` : Prisma.sql`"lastOutboundAt"`}`,
    );

    await tx.$executeRaw(Prisma.sql`
      UPDATE "Conversation"
      SET ${Prisma.join(conversationSetParts, ", ")}
      WHERE "tenancyId" = ${options.tenancyId}::uuid
        AND id = ${options.conversationId}::uuid
    `);

    await tx.$executeRaw(Prisma.sql`
      UPDATE "Conversation"
      SET
        "updatedAt" = ${now},
        "firstResponseAt" = ${nextFirstResponseAt == null ? Prisma.sql`"firstResponseAt"` : Prisma.sql`${nextFirstResponseAt}`},
        "lastCustomerReplyAt" = ${shouldTrackReplies && sender.type === "user" ? Prisma.sql`${now}` : Prisma.sql`"lastCustomerReplyAt"`},
        "lastAgentReplyAt" = ${shouldTrackReplies && sender.type === "agent" ? Prisma.sql`${now}` : Prisma.sql`"lastAgentReplyAt"`},
        "nextResponseDueAt" = ${
          shouldClearNextResponseDueAt
            ? Prisma.sql`NULL`
            : nextResponseDueAt != null
              ? Prisma.sql`${nextResponseDueAt}`
              : Prisma.sql`"nextResponseDueAt"`
        }
      WHERE "tenancyId" = ${options.tenancyId}::uuid
        AND id = ${options.conversationId}::uuid
    `);
  });
}

export async function updateConversationStatus(options: {
  tenancyId: string,
  conversationId: string,
  status: ConversationStatus,
  sender: ConversationSender,
  viewerProjectUserId?: string,
}) {
  const sender = parseSender(options.sender);
  const conversation = await getConversationState({
    tenancyId: options.tenancyId,
    conversationId: options.conversationId,
    viewerProjectUserId: options.viewerProjectUserId,
  });

  if (conversation.status === options.status) {
    throw new StatusError(400, `Conversation is already ${options.status}.`);
  }

  const now = new Date();
  const messageId = generateUuid();

  await retryTransaction(globalPrismaClient, async (tx) => {
    await tx.$executeRaw(Prisma.sql`
      UPDATE "Conversation"
      SET
        status = ${options.status},
        "updatedAt" = ${now},
        "lastMessageAt" = ${now},
        "closedAt" = ${options.status === "closed" ? Prisma.sql`${now}` : Prisma.sql`NULL`}
      WHERE "tenancyId" = ${options.tenancyId}::uuid
        AND id = ${options.conversationId}::uuid
    `);

    await tx.$executeRaw(Prisma.sql`
      INSERT INTO "ConversationMessage" (
        id,
        "tenancyId",
        "conversationId",
        "channelId",
        "messageType",
        "senderType",
        "senderId",
        "senderDisplayName",
        "senderPrimaryEmail",
        body,
        attachments,
        metadata,
        "createdAt"
      )
      VALUES (
        ${messageId}::uuid,
        ${options.tenancyId}::uuid,
        ${options.conversationId}::uuid,
        NULL,
        'status-change',
        ${sender.type},
        ${sender.id},
        ${sender.displayName},
        ${sender.primaryEmail},
        NULL,
        ${jsonbParam([])},
        ${jsonbParam({ status: options.status })},
        ${now}
      )
    `);
  });
}

export async function updateConversationAttributes(options: {
  tenancyId: string,
  conversationId: string,
  assignedToUserId?: string | null,
  assignedToDisplayName?: string | null,
  tags?: string[],
  priority?: ConversationPriority,
}) {
  const conversationUpdates: Prisma.Sql[] = [];

  if ("assignedToUserId" in options) {
    conversationUpdates.push(Prisma.sql`"assignedToUserId" = ${options.assignedToUserId ?? null}`);
  }
  if ("assignedToDisplayName" in options) {
    conversationUpdates.push(Prisma.sql`"assignedToDisplayName" = ${options.assignedToDisplayName ?? null}`);
  }
  if ("tags" in options) {
    conversationUpdates.push(Prisma.sql`tags = ${jsonbParam(options.tags ?? [])}`);
  }

  await retryTransaction(globalPrismaClient, async (tx) => {
    if (options.priority != null) {
      await tx.$executeRaw(Prisma.sql`
        UPDATE "Conversation"
        SET
          priority = ${options.priority},
          "updatedAt" = NOW()
        WHERE "tenancyId" = ${options.tenancyId}::uuid
          AND id = ${options.conversationId}::uuid
      `);
    }

    if (conversationUpdates.length > 0) {
      await tx.$executeRaw(Prisma.sql`
        UPDATE "Conversation"
        SET
          ${Prisma.join(conversationUpdates, ", ")},
          "updatedAt" = NOW()
        WHERE "tenancyId" = ${options.tenancyId}::uuid
          AND id = ${options.conversationId}::uuid
      `);
    }
  });
}

import.meta.vitest?.describe("conversation helpers", (test) => {
  test("nextConversationStatusAfterAppend moves open → pending on agent message", ({ expect }) => {
    expect(nextConversationStatusAfterAppend({
      messageType: "message",
      senderType: "agent",
      currentStatus: "open",
    })).toBe("pending");
  });

  test("nextConversationStatusAfterAppend moves pending → open on user message", ({ expect }) => {
    expect(nextConversationStatusAfterAppend({
      messageType: "message",
      senderType: "user",
      currentStatus: "pending",
    })).toBe("open");
  });

  test("nextConversationStatusAfterAppend leaves open on user message", ({ expect }) => {
    expect(nextConversationStatusAfterAppend({
      messageType: "message",
      senderType: "user",
      currentStatus: "open",
    })).toBe(null);
  });

  test("nextConversationStatusAfterAppend leaves internal notes unchanged", ({ expect }) => {
    expect(nextConversationStatusAfterAppend({
      messageType: "internal-note",
      senderType: "agent",
      currentStatus: "open",
    })).toBe(null);
  });

  test("previewForSummary returns body text for messages", ({ expect }) => {
    expect(previewForSummary({
      latestBody: "  Need help with onboarding  ",
      latestMessageType: "message",
      status: "open",
    })).toBe("Need help with onboarding");
  });

  test("previewForSummary formats status changes without a body", ({ expect }) => {
    expect(previewForSummary({
      latestBody: null,
      latestMessageType: "status-change",
      status: "closed",
    })).toBe("Conversation closed");
  });
});
