import { ContactChannelType } from "@prisma/client";
import { normalizeEmail } from "./emails";
import { PrismaTransaction } from "./types";

const fullContactChannelInclude = {
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
};

async function getAuthContactChannel(
  tx: PrismaTransaction,
  options: {
    tenancyId: string,
    type: ContactChannelType,
    value: string,
  }
) {
  return await tx.contactChannel.findUnique({
    where: {
      tenancyId_type_value_usedForAuth: {
        tenancyId: options.tenancyId,
        type: options.type,
        value: options.value,
        usedForAuth: "TRUE",
      }
    },
    include: fullContactChannelInclude,
  });
}

/**
 * Looks up an auth contact channel by email, trying both unnormalized and normalized versions.
 * This handles the migration period where some emails in the DB are unnormalized.
 *
 * The lookup order is:
 * 1. Try the email as-is (unnormalized)
 * 2. If not found, try the normalized version
 *
 * @param tx - Prisma transaction
 * @param options - Lookup options including tenancyId, type, and email value
 * @returns The contact channel if found, null otherwise
 */
export async function getAuthContactChannelWithEmailNormalization(
  tx: PrismaTransaction,
  options: {
    tenancyId: string,
    type: ContactChannelType,
    value: string,
  }
) {
  // First try to find with the unnormalized email (for legacy data)
  const unnormalizedResult = await getAuthContactChannel(tx, options);
  if (unnormalizedResult) {
    return unnormalizedResult;
  }

  // If not found, try with normalized email
  // Note: Currently all ContactChannelType values support normalization (only EMAIL exists)
  const normalizedEmail = normalizeEmail(options.value);
  // Only try normalized if it's different from the original
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
