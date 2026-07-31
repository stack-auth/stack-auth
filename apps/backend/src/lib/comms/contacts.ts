import { BooleanTrue, Prisma, type Contact as ContactRow, type ContactChannel as ContactChannelRow } from "@/generated/prisma/client";
import { recordExternalDbSyncDeletion, withExternalDbSyncUpdate } from "@/lib/external-db-sync";
import type { PrismaTransaction } from "@/lib/types";
import {
  type Contact,
  type ContactChannel,
  type ContactChannelTypeValue,
  type ContactChannelWrite,
  type ContactCreate,
  type ContactUpdate,
} from "@hexclave/shared/dist/interface/comms";
import { HexclaveAssertionError, StatusError, throwErr } from "@hexclave/shared/dist/utils/errors";
import { stringCompare } from "@hexclave/shared/dist/utils/strings";
import { generateUuid } from "@hexclave/shared/dist/utils/uuids";
import {
  contactChannelDataToJson,
  contactChannelTypeToApi,
  contactChannelTypeToPrisma,
  formatDisplayValue,
  isContactChannelTypeValue,
  normalizeContactChannelWrite,
  typeSpecificFieldsFromStored,
  type ContactChannelPrismaType,
} from "./contact-channel-types";
import { lockIdempotencyKey, operationMetadataMatches } from "./operation-requests";

type ContactWithRelations = ContactRow & {
  projectUser: { projectUserId: string } | null,
  contactChannels: ContactChannelRow[],
};

function millisOrNull(value: Date | null | undefined): number | null {
  return value == null ? null : value.getTime();
}

function jsonOrNull(value: Prisma.JsonValue | null): Contact["client_metadata"] {
  if (value === null) return null;
  // Prisma JsonValue is structurally compatible with our jsonSchema output.
  return value;
}

export function contactChannelRowToApi(row: ContactChannelRow): ContactChannel {
  const type = contactChannelTypeToApi(row.type);
  const typeFields = typeSpecificFieldsFromStored({
    type: row.type,
    identityScope: row.identityScope,
    data: row.data,
  });
  const displayValue = formatDisplayValue(type, row.value, row.data instanceof Object && !Array.isArray(row.data)
    ? row.data
    : null);

  const base = {
    id: row.id,
    contact_id: row.contactId,
    value: row.value,
    display_value: displayValue,
    is_primary: row.isPrimary === BooleanTrue.TRUE,
    is_verified: row.isVerified,
    verified_at_millis: millisOrNull(row.verifiedAt),
    metadata: jsonOrNull(row.metadata),
    created_at_millis: row.createdAt.getTime(),
    updated_at_millis: row.updatedAt.getTime(),
  };

  switch (type) {
    case "email": {
      return { ...base, type: "email" };
    }
    case "phone": {
      return {
        ...base,
        type: "phone",
        extension: typeof typeFields.extension === "string" || typeFields.extension === null
          ? typeFields.extension
          : null,
      };
    }
    case "discord": {
      return { ...base, type: "discord" };
    }
    case "slack": {
      const workspaceId = typeFields.workspace_id;
      if (typeof workspaceId !== "string") {
        throw new HexclaveAssertionError("Slack channel missing workspace_id after type-specific decode", { row });
      }
      return { ...base, type: "slack", workspace_id: workspaceId };
    }
    case "push": {
      const provider = typeFields.provider;
      const appId = typeFields.app_id;
      const environment = typeFields.environment;
      if (provider !== "apns" && provider !== "fcm") {
        throw new HexclaveAssertionError("Push channel missing provider after type-specific decode", { row });
      }
      if (typeof appId !== "string") {
        throw new HexclaveAssertionError("Push channel missing app_id after type-specific decode", { row });
      }
      if (environment !== "development" && environment !== "production") {
        throw new HexclaveAssertionError("Push channel missing environment after type-specific decode", { row });
      }
      return {
        ...base,
        type: "push",
        provider,
        app_id: appId,
        environment,
      };
    }
    default: {
      throw new HexclaveAssertionError(`Unhandled contact channel type: ${type satisfies never}`);
    }
  }
}

export function contactRowToApi(row: ContactWithRelations): Contact {
  return {
    id: row.id,
    display_name: row.displayName,
    profile_image_url: row.profileImageUrl,
    client_metadata: jsonOrNull(row.clientMetadata),
    client_read_only_metadata: jsonOrNull(row.clientReadOnlyMetadata),
    server_metadata: jsonOrNull(row.serverMetadata),
    merged_into_contact_id: row.mergedIntoContactId,
    merged_at_millis: millisOrNull(row.mergedAt),
    is_user_backed: row.projectUser != null,
    channels: row.contactChannels.map(contactChannelRowToApi),
    created_at_millis: row.createdAt.getTime(),
    updated_at_millis: row.updatedAt.getTime(),
  };
}

const contactInclude = {
  projectUser: {
    select: { projectUserId: true },
  },
  contactChannels: {
    orderBy: [
      { type: "asc" as const },
      { createdAt: "asc" as const },
      { id: "asc" as const },
    ],
  },
};

async function lockContactsBySortedIds(
  tx: PrismaTransaction,
  tenancyId: string,
  contactIds: readonly string[],
): Promise<void> {
  const sorted = [...new Set(contactIds)].sort(stringCompare);
  if (sorted.length === 0) return;
  // Deterministic lock order avoids deadlocks between concurrent merge/resolve ops.
  await tx.$queryRaw`
    SELECT 1 FROM "Contact"
    WHERE "tenancyId" = ${tenancyId}::uuid
      AND "id" = ANY(${sorted}::uuid[])
    ORDER BY "id"
    FOR UPDATE
  `;
}

async function createChannelRows(
  tx: PrismaTransaction,
  options: {
    tenancyId: string,
    contactId: string,
    channels: ContactChannelWrite[],
  },
): Promise<void> {
  for (const channel of options.channels) {
    const normalized = normalizeContactChannelWrite(channel);
    if (channel.is_primary === true) {
      await tx.contactChannel.updateMany({
        where: {
          tenancyId: options.tenancyId,
          contactId: options.contactId,
          type: normalized.prismaType,
          isPrimary: BooleanTrue.TRUE,
        },
        data: withExternalDbSyncUpdate({ isPrimary: null }),
      });
    }
    await tx.contactChannel.create({
      data: {
        tenancyId: options.tenancyId,
        contactId: options.contactId,
        type: normalized.prismaType,
        value: normalized.value,
        identityScope: normalized.identityScope,
        // Prisma InputJsonValue rejects Record<string, unknown>; channel data is always JSON-serializable.
        data: (contactChannelDataToJson(normalized.data) as Prisma.InputJsonValue | null) ?? Prisma.JsonNull,
        isPrimary: channel.is_primary === true ? BooleanTrue.TRUE : null,
        isVerified: channel.is_verified === true,
        verifiedAt: channel.is_verified === true ? new Date() : null,
        metadata: channel.metadata === undefined
          ? undefined
          : channel.metadata === null
            ? Prisma.JsonNull
            : channel.metadata,
      },
    });
  }
}

export async function createContact(
  tx: PrismaTransaction,
  options: {
    tenancyId: string,
    data: ContactCreate,
  },
): Promise<Contact> {
  const id = options.data.id ?? generateUuid();
  await tx.contact.create({
    data: withExternalDbSyncUpdate({
      tenancyId: options.tenancyId,
      id,
      displayName: options.data.display_name ?? null,
      profileImageUrl: options.data.profile_image_url ?? null,
      clientMetadata: options.data.client_metadata === undefined
        ? undefined
        : options.data.client_metadata === null
          ? Prisma.JsonNull
          : options.data.client_metadata,
      clientReadOnlyMetadata: options.data.client_read_only_metadata === undefined
        ? undefined
        : options.data.client_read_only_metadata === null
          ? Prisma.JsonNull
          : options.data.client_read_only_metadata,
      serverMetadata: options.data.server_metadata === undefined
        ? undefined
        : options.data.server_metadata === null
          ? Prisma.JsonNull
          : options.data.server_metadata,
    }),
  });

  if (options.data.channels != null && options.data.channels.length > 0) {
    await createChannelRows(tx, {
      tenancyId: options.tenancyId,
      contactId: id,
      channels: options.data.channels,
    });
  }

  return await getContact(tx, { tenancyId: options.tenancyId, contactId: id })
    ?? throwErr("Contact missing immediately after create; this should never happen", { id, tenancyId: options.tenancyId });
}

export async function getContact(
  tx: PrismaTransaction,
  options: {
    tenancyId: string,
    contactId: string,
  },
): Promise<Contact | null> {
  const row = await tx.contact.findUnique({
    where: {
      tenancyId_id: {
        tenancyId: options.tenancyId,
        id: options.contactId,
      },
    },
    include: contactInclude,
  });
  return row == null ? null : contactRowToApi(row);
}

export async function listContacts(
  tx: PrismaTransaction,
  options: {
    tenancyId: string,
    includeMerged?: boolean,
    limit?: number,
    cursor?: string,
  },
): Promise<{ contacts: Contact[], nextCursor: string | null }> {
  const limit = options.limit ?? 50;
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
    throw new StatusError(StatusError.BadRequest, "limit must be an integer between 1 and 200");
  }

  const rows = await tx.contact.findMany({
    where: {
      tenancyId: options.tenancyId,
      ...(options.includeMerged === true ? {} : { mergedIntoContactId: null }),
      ...(options.cursor == null ? {} : {
        id: { gt: options.cursor },
      }),
    },
    include: contactInclude,
    orderBy: { id: "asc" },
    take: limit + 1,
  });

  const page = rows.slice(0, limit);
  const hasMore = rows.length > limit;
  return {
    contacts: page.map(contactRowToApi),
    nextCursor: hasMore
      ? (page[page.length - 1]?.id ?? throwErr("listContacts page unexpectedly empty when hasMore is true"))
      : null,
  };
}

export async function updateContact(
  tx: PrismaTransaction,
  options: {
    tenancyId: string,
    contactId: string,
    data: ContactUpdate,
  },
): Promise<Contact> {
  const existing = await tx.contact.findUnique({
    where: {
      tenancyId_id: {
        tenancyId: options.tenancyId,
        id: options.contactId,
      },
    },
    select: { id: true, mergedIntoContactId: true },
  });
  if (existing == null) {
    throw new StatusError(StatusError.NotFound, "Contact not found");
  }
  if (existing.mergedIntoContactId != null) {
    throw new StatusError(StatusError.BadRequest, "Cannot update a merged (non-canonical) contact");
  }

  await tx.contact.update({
    where: {
      tenancyId_id: {
        tenancyId: options.tenancyId,
        id: options.contactId,
      },
    },
    data: withExternalDbSyncUpdate({
      ...(options.data.display_name !== undefined ? { displayName: options.data.display_name } : {}),
      ...(options.data.profile_image_url !== undefined ? { profileImageUrl: options.data.profile_image_url } : {}),
      ...(options.data.client_metadata !== undefined
        ? { clientMetadata: options.data.client_metadata === null ? Prisma.JsonNull : options.data.client_metadata }
        : {}),
      ...(options.data.client_read_only_metadata !== undefined
        ? { clientReadOnlyMetadata: options.data.client_read_only_metadata === null ? Prisma.JsonNull : options.data.client_read_only_metadata }
        : {}),
      ...(options.data.server_metadata !== undefined
        ? { serverMetadata: options.data.server_metadata === null ? Prisma.JsonNull : options.data.server_metadata }
        : {}),
    }),
  });

  return await getContact(tx, options)
    ?? throwErr("Contact missing immediately after update; this should never happen", options);
}

export async function deleteContact(
  tx: PrismaTransaction,
  options: {
    tenancyId: string,
    contactId: string,
  },
): Promise<void> {
  const existing = await tx.contact.findUnique({
    where: {
      tenancyId_id: {
        tenancyId: options.tenancyId,
        id: options.contactId,
      },
    },
    include: {
      projectUser: { select: { projectUserId: true } },
    },
  });
  if (existing == null) {
    throw new StatusError(StatusError.NotFound, "Contact not found");
  }
  if (existing.projectUser != null) {
    throw new StatusError(
      StatusError.BadRequest,
      "Cannot delete a user-backed contact. Delete the ProjectUser first; the contact is retained after user deletion.",
    );
  }
  if (existing.mergedIntoContactId != null) {
    throw new StatusError(StatusError.BadRequest, "Cannot delete a merged (non-canonical) contact");
  }

  await tx.contact.delete({
    where: {
      tenancyId_id: {
        tenancyId: options.tenancyId,
        id: options.contactId,
      },
    },
  });
}

/**
 * Creates a Contact with the same UUID as the forthcoming ProjectUser.
 * Must run in the same transaction, before the ProjectUser insert.
 */
export async function ensureContactForNewUser(
  tx: PrismaTransaction,
  options: {
    tenancyId: string,
    projectUserId: string,
    displayName?: string | null,
    profileImageUrl?: string | null,
    clientMetadata?: Prisma.InputJsonValue | null,
    clientReadOnlyMetadata?: Prisma.InputJsonValue | null,
    serverMetadata?: Prisma.InputJsonValue | null,
  },
): Promise<ContactRow> {
  const existing = await tx.contact.findUnique({
    where: {
      tenancyId_id: {
        tenancyId: options.tenancyId,
        id: options.projectUserId,
      },
    },
  });
  if (existing != null) {
    throw new HexclaveAssertionError(
      "ensureContactForNewUser called but a Contact with this UUID already exists",
      { tenancyId: options.tenancyId, projectUserId: options.projectUserId },
    );
  }

  return await tx.contact.create({
    data: {
      tenancyId: options.tenancyId,
      id: options.projectUserId,
      displayName: options.displayName ?? null,
      profileImageUrl: options.profileImageUrl ?? null,
      clientMetadata: options.clientMetadata === undefined
        ? undefined
        : options.clientMetadata === null
          ? Prisma.JsonNull
          : options.clientMetadata,
      clientReadOnlyMetadata: options.clientReadOnlyMetadata === undefined
        ? undefined
        : options.clientReadOnlyMetadata === null
          ? Prisma.JsonNull
          : options.clientReadOnlyMetadata,
      serverMetadata: options.serverMetadata === undefined
        ? undefined
        : options.serverMetadata === null
          ? Prisma.JsonNull
          : options.serverMetadata,
    },
  });
}

export type ContactProfileFields = {
  displayName: string | null,
  profileImageUrl: string | null,
  clientMetadata: Prisma.JsonValue | null,
  clientReadOnlyMetadata: Prisma.JsonValue | null,
  serverMetadata: Prisma.JsonValue | null,
};

/** Compatibility helper: read user profile fields from the same-UUID Contact. */
export async function getContactProfileForUser(
  tx: PrismaTransaction,
  options: {
    tenancyId: string,
    projectUserId: string,
  },
): Promise<ContactProfileFields> {
  const contact = await tx.contact.findUnique({
    where: {
      tenancyId_id: {
        tenancyId: options.tenancyId,
        id: options.projectUserId,
      },
    },
    select: {
      displayName: true,
      profileImageUrl: true,
      clientMetadata: true,
      clientReadOnlyMetadata: true,
      serverMetadata: true,
    },
  });
  if (contact == null) {
    throw new HexclaveAssertionError(
      "ProjectUser is missing its required same-UUID Contact",
      options,
    );
  }
  return contact;
}

/**
 * Whether this channel is selected for auth by the given project user.
 * Prefer this over the removed ContactChannel.usedForAuth column.
 */
export function contactChannelIsUsedForAuth(
  channel: { authSelections: ReadonlyArray<{ projectUserId: string }> },
  projectUserId: string,
): boolean {
  return channel.authSelections.some((selection) => selection.projectUserId === projectUserId);
}

/** Compatibility helper: write user profile fields onto the same-UUID Contact. */
export async function updateContactProfileForUser(
  tx: PrismaTransaction,
  options: {
    tenancyId: string,
    projectUserId: string,
    displayName?: string | null,
    profileImageUrl?: string | null,
    clientMetadata?: Prisma.InputJsonValue | null,
    clientReadOnlyMetadata?: Prisma.InputJsonValue | null,
    serverMetadata?: Prisma.InputJsonValue | null,
  },
): Promise<ContactProfileFields> {
  const updated = await tx.contact.update({
    where: {
      tenancyId_id: {
        tenancyId: options.tenancyId,
        id: options.projectUserId,
      },
    },
    data: {
      ...(options.displayName !== undefined ? { displayName: options.displayName } : {}),
      ...(options.profileImageUrl !== undefined ? { profileImageUrl: options.profileImageUrl } : {}),
      ...(options.clientMetadata !== undefined
        ? { clientMetadata: options.clientMetadata === null ? Prisma.JsonNull : options.clientMetadata }
        : {}),
      ...(options.clientReadOnlyMetadata !== undefined
        ? { clientReadOnlyMetadata: options.clientReadOnlyMetadata === null ? Prisma.JsonNull : options.clientReadOnlyMetadata }
        : {}),
      ...(options.serverMetadata !== undefined
        ? { serverMetadata: options.serverMetadata === null ? Prisma.JsonNull : options.serverMetadata }
        : {}),
    },
    select: {
      displayName: true,
      profileImageUrl: true,
      clientMetadata: true,
      clientReadOnlyMetadata: true,
      serverMetadata: true,
    },
  });
  return updated;
}

export type ResolveContactForIdentityResult = {
  contact: Contact | null,
  candidateIds: string[],
  ambiguous: boolean,
};

/**
 * Resolves an identity to a canonical contact without creating one.
 * Prefers user-backed contacts; otherwise picks the oldest by (createdAt, id).
 * `ambiguous` is true when more than one candidate matched.
 */
export async function resolveContactForIdentity(
  tx: PrismaTransaction,
  options: {
    tenancyId: string,
    type: ContactChannelTypeValue | ContactChannelPrismaType,
    value: string,
    identityScope: string,
  },
): Promise<ResolveContactForIdentityResult> {
  const prismaType = typeof options.type === "string" && isContactChannelTypeValue(options.type)
    ? contactChannelTypeToPrisma(options.type)
    : options.type;

  const channels = await tx.contactChannel.findMany({
    where: {
      tenancyId: options.tenancyId,
      type: prismaType,
      value: options.value,
      identityScope: options.identityScope,
      contact: {
        mergedIntoContactId: null,
      },
    },
    include: {
      contact: {
        include: contactInclude,
      },
    },
    orderBy: [
      { contact: { createdAt: "asc" } },
      { contact: { id: "asc" } },
    ],
  });

  if (channels.length === 0) {
    return { contact: null, candidateIds: [], ambiguous: false };
  }

  const byContactId = new Map<string, ContactWithRelations>();
  for (const channel of channels) {
    if (!byContactId.has(channel.contactId)) {
      byContactId.set(channel.contactId, channel.contact);
    }
  }
  const candidates = [...byContactId.values()];
  const candidateIds = candidates.map((c) => c.id);

  const userBacked = candidates.filter((c) => c.projectUser != null);
  const chosenPool = userBacked.length > 0 ? userBacked : candidates;
  const chosen = [...chosenPool].sort((a, b) => {
    const createdDiff = a.createdAt.getTime() - b.createdAt.getTime();
    if (createdDiff !== 0) return createdDiff;
    return stringCompare(a.id, b.id);
  })[0] ?? throwErr("resolveContactForIdentity produced no chosen contact despite candidates", { candidateIds });

  return {
    contact: contactRowToApi(chosen),
    candidateIds,
    ambiguous: candidateIds.length > 1,
  };
}

export async function mergeContacts(
  tx: PrismaTransaction,
  options: {
    tenancyId: string,
    sourceId: string,
    targetId: string,
    idempotencyKey: string,
    actorUserId?: string | null,
    reason?: string | null,
    metadata?: Prisma.InputJsonValue | null,
  },
): Promise<{ operationId: string, contact: Contact, replayed: boolean }> {
  if (options.sourceId === options.targetId) {
    throw new StatusError(StatusError.BadRequest, "source and target contacts must differ");
  }

  await lockIdempotencyKey(tx, {
    namespace: "contact-merge",
    tenancyId: options.tenancyId,
    idempotencyKey: options.idempotencyKey,
  });
  const existingOperation = await tx.contactMergeOperation.findUnique({
    where: {
      tenancyId_idempotencyKey: {
        tenancyId: options.tenancyId,
        idempotencyKey: options.idempotencyKey,
      },
    },
  });
  if (existingOperation != null) {
    if (
      existingOperation.sourceContactId !== options.sourceId
      || existingOperation.targetContactId !== options.targetId
      || existingOperation.actorUserId !== (options.actorUserId ?? null)
      || existingOperation.reason !== (options.reason ?? null)
      || !operationMetadataMatches(existingOperation.metadata, options.metadata)
    ) {
      throw new StatusError(
        StatusError.Conflict,
        "Idempotency key was already used for a different contact merge",
      );
    }
    const contact = await getContact(tx, { tenancyId: options.tenancyId, contactId: options.targetId })
      ?? throwErr("Target contact missing for replayed merge operation", options);
    return { operationId: existingOperation.id, contact, replayed: true };
  }

  await lockContactsBySortedIds(tx, options.tenancyId, [options.sourceId, options.targetId]);

  const [source, target] = await Promise.all([
    tx.contact.findUnique({
      where: { tenancyId_id: { tenancyId: options.tenancyId, id: options.sourceId } },
      include: {
        projectUser: { select: { projectUserId: true } },
        contactChannels: true,
        _count: { select: { mergedFromContacts: true } },
      },
    }),
    tx.contact.findUnique({
      where: { tenancyId_id: { tenancyId: options.tenancyId, id: options.targetId } },
      include: {
        projectUser: { select: { projectUserId: true } },
      },
    }),
  ]);

  if (source == null) {
    throw new StatusError(StatusError.NotFound, "Source contact not found");
  }
  if (target == null) {
    throw new StatusError(StatusError.NotFound, "Target contact not found");
  }
  if (source.mergedIntoContactId != null) {
    throw new StatusError(StatusError.BadRequest, "Source contact is already merged");
  }
  if (target.mergedIntoContactId != null) {
    throw new StatusError(StatusError.BadRequest, "Target contact is already merged");
  }
  if (source.projectUser != null) {
    throw new StatusError(
      StatusError.BadRequest,
      "Cannot merge a user-backed contact as the source. Merge CRM-only contacts into the user-backed contact instead.",
    );
  }
  if (source._count.mergedFromContacts > 0) {
    throw new StatusError(
      StatusError.BadRequest,
      "Cannot merge a contact that already has merged source contacts",
    );
  }

  const operation = await tx.contactMergeOperation.create({
    data: {
      tenancyId: options.tenancyId,
      sourceContactId: options.sourceId,
      targetContactId: options.targetId,
      idempotencyKey: options.idempotencyKey,
      actorUserId: options.actorUserId ?? null,
      reason: options.reason ?? null,
      metadata: options.metadata === undefined
        ? undefined
        : options.metadata === null
          ? Prisma.JsonNull
          : options.metadata,
    },
  });

  const targetChannelKeys = new Set(
    (await tx.contactChannel.findMany({
      where: { tenancyId: options.tenancyId, contactId: options.targetId },
      select: { type: true, identityScope: true, value: true },
    })).map((c) => `${c.type}\0${c.identityScope}\0${c.value}`),
  );

  for (const channel of source.contactChannels) {
    const key = `${channel.type}\0${channel.identityScope}\0${channel.value}`;
    if (targetChannelKeys.has(key)) {
      // Exact duplicate on target: drop the source row (participants keep address snapshots).
      await tx.contactChannel.delete({
        where: {
          tenancyId_id: {
            tenancyId: options.tenancyId,
            id: channel.id,
          },
        },
      });
      continue;
    }

    if (channel.isPrimary === BooleanTrue.TRUE) {
      const targetHasPrimary = await tx.contactChannel.findFirst({
        where: {
          tenancyId: options.tenancyId,
          contactId: options.targetId,
          type: channel.type,
          isPrimary: BooleanTrue.TRUE,
        },
        select: { id: true },
      });
      if (targetHasPrimary != null) {
        await tx.contactChannel.update({
          where: {
            tenancyId_id: {
              tenancyId: options.tenancyId,
              id: channel.id,
            },
          },
          data: withExternalDbSyncUpdate({ isPrimary: null }),
        });
      }
    }

    await tx.contactChannel.update({
      where: {
        tenancyId_id: {
          tenancyId: options.tenancyId,
          id: channel.id,
        },
      },
      data: withExternalDbSyncUpdate({ contactId: options.targetId }),
    });
    targetChannelKeys.add(key);
  }

  // Participant snapshots remain immutable, but their optional live Contact
  // reference should follow the canonical merge target.
  await tx.commsMessageParticipant.updateMany({
    where: {
      tenancyId: options.tenancyId,
      contactId: options.sourceId,
    },
    data: {
      contactId: options.targetId,
    },
  });

  const now = new Date();
  await tx.contact.update({
    where: {
      tenancyId_id: {
        tenancyId: options.tenancyId,
        id: options.sourceId,
      },
    },
    data: withExternalDbSyncUpdate({
      mergedIntoContactId: options.targetId,
      mergedAt: now,
      mergeOperationId: operation.id,
    }),
  });

  const contact = await getContact(tx, { tenancyId: options.tenancyId, contactId: options.targetId })
    ?? throwErr("Target contact missing after merge; this should never happen", options);
  return { operationId: operation.id, contact, replayed: false };
}

async function requireCanonicalContact(
  tx: PrismaTransaction,
  options: { tenancyId: string, contactId: string },
): Promise<ContactRow> {
  // Child writes must serialize with merge. Otherwise a channel can be created
  // after merge enumerates the source's children and remain on the alias.
  await lockContactsBySortedIds(tx, options.tenancyId, [options.contactId]);
  const existing = await tx.contact.findUnique({
    where: {
      tenancyId_id: {
        tenancyId: options.tenancyId,
        id: options.contactId,
      },
    },
  });
  if (existing == null) {
    throw new StatusError(StatusError.NotFound, "Contact not found");
  }
  if (existing.mergedIntoContactId != null) {
    throw new StatusError(StatusError.BadRequest, "Cannot modify channels on a merged (non-canonical) contact");
  }
  return existing;
}

export async function listContactChannels(
  tx: PrismaTransaction,
  options: {
    tenancyId: string,
    contactId: string,
  },
): Promise<ContactChannel[]> {
  const contact = await tx.contact.findUnique({
    where: {
      tenancyId_id: {
        tenancyId: options.tenancyId,
        id: options.contactId,
      },
    },
    select: { id: true },
  });
  if (contact == null) {
    throw new StatusError(StatusError.NotFound, "Contact not found");
  }

  const rows = await tx.contactChannel.findMany({
    where: {
      tenancyId: options.tenancyId,
      contactId: options.contactId,
    },
    orderBy: [
      { type: "asc" },
      { createdAt: "asc" },
      { id: "asc" },
    ],
  });
  return rows.map(contactChannelRowToApi);
}

export async function getContactChannel(
  tx: PrismaTransaction,
  options: {
    tenancyId: string,
    contactId: string,
    channelId: string,
  },
): Promise<ContactChannel | null> {
  const row = await tx.contactChannel.findUnique({
    where: {
      tenancyId_id: {
        tenancyId: options.tenancyId,
        id: options.channelId,
      },
    },
  });
  if (row == null || row.contactId !== options.contactId) {
    return null;
  }
  return contactChannelRowToApi(row);
}

export async function createContactChannel(
  tx: PrismaTransaction,
  options: {
    tenancyId: string,
    contactId: string,
    channel: ContactChannelWrite,
  },
): Promise<ContactChannel> {
  await requireCanonicalContact(tx, options);
  const normalized = normalizeContactChannelWrite(options.channel);
  if (options.channel.is_primary === true) {
    await tx.contactChannel.updateMany({
      where: {
        tenancyId: options.tenancyId,
        contactId: options.contactId,
        type: normalized.prismaType,
        isPrimary: BooleanTrue.TRUE,
      },
      data: withExternalDbSyncUpdate({ isPrimary: null }),
    });
  }
  const created = await tx.contactChannel.create({
    data: {
      tenancyId: options.tenancyId,
      contactId: options.contactId,
      type: normalized.prismaType,
      value: normalized.value,
      identityScope: normalized.identityScope,
      data: (contactChannelDataToJson(normalized.data) as Prisma.InputJsonValue | null) ?? Prisma.JsonNull,
      isPrimary: options.channel.is_primary === true ? BooleanTrue.TRUE : null,
      isVerified: options.channel.is_verified === true,
      verifiedAt: options.channel.is_verified === true ? new Date() : null,
      metadata: options.channel.metadata === undefined
        ? undefined
        : options.channel.metadata === null
          ? Prisma.JsonNull
          : options.channel.metadata,
    },
  });
  return contactChannelRowToApi(created);
}

export async function updateContactChannel(
  tx: PrismaTransaction,
  options: {
    tenancyId: string,
    contactId: string,
    channelId: string,
    data: {
      is_primary?: boolean,
      is_verified?: boolean,
      metadata?: ContactChannel["metadata"],
      extension?: string | null,
    },
  },
): Promise<ContactChannel> {
  await requireCanonicalContact(tx, options);
  const existing = await tx.contactChannel.findUnique({
    where: {
      tenancyId_id: {
        tenancyId: options.tenancyId,
        id: options.channelId,
      },
    },
  });
  if (existing == null || existing.contactId !== options.contactId) {
    throw new StatusError(StatusError.NotFound, "Contact channel not found");
  }

  if (options.data.is_primary === true) {
    await tx.contactChannel.updateMany({
      where: {
        tenancyId: options.tenancyId,
        contactId: options.contactId,
        type: existing.type,
        isPrimary: BooleanTrue.TRUE,
        id: { not: options.channelId },
      },
      data: withExternalDbSyncUpdate({ isPrimary: null }),
    });
  }

  let nextData = existing.data;
  if (options.data.extension !== undefined) {
    if (existing.type !== "PHONE") {
      throw new StatusError(StatusError.BadRequest, "extension can only be set on phone channels");
    }
    const current = (existing.data != null && typeof existing.data === "object" && !Array.isArray(existing.data))
      ? { ...existing.data }
      : {};
    current.extension = options.data.extension;
    nextData = current;
  }

  const updated = await tx.contactChannel.update({
    where: {
      tenancyId_id: {
        tenancyId: options.tenancyId,
        id: options.channelId,
      },
    },
    data: withExternalDbSyncUpdate({
      ...(options.data.is_primary === true ? { isPrimary: BooleanTrue.TRUE } : {}),
      ...(options.data.is_primary === false ? { isPrimary: null } : {}),
      ...(options.data.is_verified !== undefined
        ? {
          isVerified: options.data.is_verified,
          verifiedAt: options.data.is_verified ? (existing.verifiedAt ?? new Date()) : null,
        }
        : {}),
      ...(options.data.metadata !== undefined
        ? { metadata: options.data.metadata === null ? Prisma.JsonNull : options.data.metadata }
        : {}),
      ...(options.data.extension !== undefined
        ? { data: nextData === null ? Prisma.JsonNull : (nextData as Prisma.InputJsonValue) }
        : {}),
    }),
  });
  return contactChannelRowToApi(updated);
}

export async function deleteContactChannel(
  tx: PrismaTransaction,
  options: {
    tenancyId: string,
    contactId: string,
    channelId: string,
  },
): Promise<void> {
  await requireCanonicalContact(tx, options);
  const existing = await tx.contactChannel.findUnique({
    where: {
      tenancyId_id: {
        tenancyId: options.tenancyId,
        id: options.channelId,
      },
    },
    select: {
      contactId: true,
      contact: {
        select: {
          projectUser: {
            select: { projectUserId: true },
          },
        },
      },
    },
  });
  if (existing == null || existing.contactId !== options.contactId) {
    throw new StatusError(StatusError.NotFound, "Contact channel not found");
  }

  if (existing.contact.projectUser != null) {
    await recordExternalDbSyncDeletion(tx, {
      tableName: "ContactChannel",
      tenancyId: options.tenancyId,
      projectUserId: existing.contact.projectUser.projectUserId,
      contactChannelId: options.channelId,
    });
  }
  await tx.contactChannel.delete({
    where: {
      tenancyId_id: {
        tenancyId: options.tenancyId,
        id: options.channelId,
      },
    },
  });
}
