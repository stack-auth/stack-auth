import { BooleanTrue, ContactChannelType, Prisma } from "@/generated/prisma/client";
import { markProjectUserForExternalDbSync, withExternalDbSyncUpdate } from "@/lib/external-db-sync";
import { HexclaveAssertionError, throwErr } from "@hexclave/shared/dist/utils/errors";
import { normalizeEmail } from "./emails";
import { PrismaTransaction } from "./types";

const fullContactChannelInclude = {
  contact: {
    include: {
      projectUser: {
        include: {
          authMethods: {
            include: {
              otpAuthMethod: true,
              passwordAuthMethod: true,
            }
          }
        }
      }
    }
  },
  authSelections: true,
} satisfies Prisma.ContactChannelInclude;

/**
 * Demotes all contact channels of a given type for a contact to non-primary.
 * For user-backed contacts, contactId === projectUserId.
 */
export async function demoteAllContactChannelsToNonPrimary(
  tx: PrismaTransaction,
  options: {
    tenancyId: string,
    contactId: string,
    type: ContactChannelType,
  }
) {
  await tx.contactChannel.updateMany({
    where: {
      tenancyId: options.tenancyId,
      contactId: options.contactId,
      type: options.type,
      isPrimary: BooleanTrue.TRUE,
    },
    data: withExternalDbSyncUpdate({
      isPrimary: null,
    }),
  });
  await markProjectUserForExternalDbSyncIfExists(tx, {
    tenancyId: options.tenancyId,
    projectUserId: options.contactId,
  });
}

/**
 * Sets a contact channel as primary, demoting all other contact channels of the same type.
 */
export async function setContactChannelAsPrimaryById(
  tx: PrismaTransaction,
  options: {
    tenancyId: string,
    contactId: string,
    contactChannelId: string,
    type: ContactChannelType,
    additionalUpdates?: {
      isVerified?: boolean,
    },
  }
) {
  const targetChannel = await tx.contactChannel.findUnique({
    where: {
      tenancyId_id: {
        tenancyId: options.tenancyId,
        id: options.contactChannelId,
      },
    },
  });

  if (!targetChannel) {
    throw new HexclaveAssertionError(
      `Contact channel not found with id ${options.contactChannelId} for contact ${options.contactId} in tenancy ${options.tenancyId}`,
      { options }
    );
  }

  if (targetChannel.contactId !== options.contactId) {
    throw new HexclaveAssertionError(
      `Contact channel ${options.contactChannelId} does not belong to contact ${options.contactId}`,
      { options, actualContactId: targetChannel.contactId }
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (targetChannel.type !== options.type) {
    throw new HexclaveAssertionError(
      `Contact channel type mismatch: expected ${options.type}, got ${targetChannel.type}`,
      { options, actualType: targetChannel.type }
    );
  }

  await demoteAllContactChannelsToNonPrimary(tx, {
    tenancyId: options.tenancyId,
    contactId: options.contactId,
    type: options.type,
  });

  await tx.contactChannel.update({
    where: {
      tenancyId_id: {
        tenancyId: options.tenancyId,
        id: options.contactChannelId,
      },
    },
    data: withExternalDbSyncUpdate({
      isPrimary: BooleanTrue.TRUE,
      ...options.additionalUpdates,
    }),
  });
  await markProjectUserForExternalDbSyncIfExists(tx, {
    tenancyId: options.tenancyId,
    projectUserId: options.contactId,
  });
}

/**
 * Sets a contact channel as primary by its value, demoting all other contact channels of the same type.
 */
export async function setContactChannelAsPrimaryByValue(
  tx: PrismaTransaction,
  options: {
    tenancyId: string,
    contactId: string,
    type: ContactChannelType,
    value: string,
    additionalUpdates?: {
      isVerified?: boolean,
    },
  }
) {
  await demoteAllContactChannelsToNonPrimary(tx, {
    tenancyId: options.tenancyId,
    contactId: options.contactId,
    type: options.type,
  });

  await tx.contactChannel.update({
    where: {
      tenancyId_contactId_type_identityScope_value: {
        tenancyId: options.tenancyId,
        contactId: options.contactId,
        type: options.type,
        identityScope: "",
        value: options.value,
      },
    },
    data: withExternalDbSyncUpdate({
      isPrimary: BooleanTrue.TRUE,
      ...options.additionalUpdates,
    }),
  });
  await markProjectUserForExternalDbSyncIfExists(tx, {
    tenancyId: options.tenancyId,
    projectUserId: options.contactId,
  });
}

async function getAuthContactChannel(
  tx: PrismaTransaction,
  options: {
    tenancyId: string,
    type: ContactChannelType,
    value: string,
    identityScope?: string,
  }
) {
  const authSelection = await tx.projectUserAuthContactChannel.findUnique({
    where: {
      tenancyId_type_identityScope_value: {
        tenancyId: options.tenancyId,
        type: options.type,
        identityScope: options.identityScope ?? "",
        value: options.value,
      }
    },
    include: {
      contactChannel: {
        include: fullContactChannelInclude,
      },
    },
  });
  return authSelection?.contactChannel ?? null;
}

/**
 * Looks up an auth contact channel by email, trying both unnormalized and normalized versions.
 */
export async function getAuthContactChannelWithEmailNormalization(
  tx: PrismaTransaction,
  options: {
    tenancyId: string,
    type: ContactChannelType,
    value: string,
  }
) {
  const unnormalizedResult = await getAuthContactChannel(tx, options);
  if (unnormalizedResult) {
    return unnormalizedResult;
  }

  const normalizedEmail = normalizeEmail(options.value);
  if (normalizedEmail !== options.value) {
    const normalizedResult = await getAuthContactChannel(tx, {
      ...options,
      value: normalizedEmail,
    });
    if (normalizedResult) {
      return normalizedResult;
    }
  }

  return null;
}

export async function setContactChannelUsedForAuth(
  tx: PrismaTransaction,
  options: {
    tenancyId: string,
    projectUserId: string,
    contactChannelId: string,
    usedForAuth: boolean,
  }
) {
  const channel = await tx.contactChannel.findUnique({
    where: {
      tenancyId_id: {
        tenancyId: options.tenancyId,
        id: options.contactChannelId,
      },
    },
  }) ?? throwErr(`Contact channel ${options.contactChannelId} not found`);

  if (channel.contactId !== options.projectUserId) {
    throw new HexclaveAssertionError(
      `Contact channel ${options.contactChannelId} does not belong to user/contact ${options.projectUserId}`,
      { options, actualContactId: channel.contactId }
    );
  }

  if (options.usedForAuth) {
    await tx.projectUserAuthContactChannel.upsert({
      where: {
        tenancyId_projectUserId_contactChannelId: {
          tenancyId: options.tenancyId,
          projectUserId: options.projectUserId,
          contactChannelId: options.contactChannelId,
        },
      },
      create: {
        tenancyId: options.tenancyId,
        projectUserId: options.projectUserId,
        contactChannelId: options.contactChannelId,
        type: channel.type,
        identityScope: channel.identityScope,
        value: channel.value,
      },
      update: {
        type: channel.type,
        identityScope: channel.identityScope,
        value: channel.value,
      },
    });
  } else {
    await tx.projectUserAuthContactChannel.deleteMany({
      where: {
        tenancyId: options.tenancyId,
        projectUserId: options.projectUserId,
        contactChannelId: options.contactChannelId,
      },
    });
  }

  await markProjectUserForExternalDbSync(tx, {
    tenancyId: options.tenancyId,
    projectUserId: options.projectUserId,
  });
}

async function markProjectUserForExternalDbSyncIfExists(
  tx: PrismaTransaction,
  options: { tenancyId: string, projectUserId: string }
) {
  const user = await tx.projectUser.findUnique({
    where: {
      tenancyId_projectUserId: {
        tenancyId: options.tenancyId,
        projectUserId: options.projectUserId,
      },
    },
    select: { projectUserId: true },
  });
  if (user != null) {
    await markProjectUserForExternalDbSync(tx, options);
  }
}

/** @deprecated Use contactId; kept as alias while call sites migrate. */
export async function demoteAllContactChannelsToNonPrimaryForUser(
  tx: PrismaTransaction,
  options: { tenancyId: string, projectUserId: string, type: ContactChannelType }
) {
  return await demoteAllContactChannelsToNonPrimary(tx, {
    tenancyId: options.tenancyId,
    contactId: options.projectUserId,
    type: options.type,
  });
}
