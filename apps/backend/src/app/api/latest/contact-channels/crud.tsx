import { Prisma } from "@/generated/prisma/client";
import { contactChannelIsUsedForAuth } from "@/lib/comms/contacts";
import { demoteAllContactChannelsToNonPrimary, setContactChannelAsPrimaryById, setContactChannelUsedForAuth } from "@/lib/contact-channel";
import { normalizeEmail } from "@/lib/emails";
import { markProjectUserForExternalDbSync, recordExternalDbSyncDeletion, withExternalDbSyncUpdate } from "@/lib/external-db-sync";
import { ensureContactChannelDoesNotExists, ensureContactChannelExists } from "@/lib/request-checks";
import { getPrismaClientForTenancy, retryTransaction } from "@/prisma-client";
import { createCrudHandlers } from "@/route-handlers/crud-handler";
import { KnownErrors } from "@hexclave/shared";
import { contactChannelsCrud } from "@hexclave/shared/dist/interface/crud/contact-channels";
import { userIdOrMeSchema, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";
import { StatusError, throwErr } from "@hexclave/shared/dist/utils/errors";
import { createLazyProxy } from "@hexclave/shared/dist/utils/proxies";
import { typedToLowercase, typedToUppercase } from "@hexclave/shared/dist/utils/strings";

type ContactChannelWithAuthSelections = Prisma.ContactChannelGetPayload<{
  include: { authSelections: true },
}>;

export const contactChannelToCrud = (channel: ContactChannelWithAuthSelections) => {
  if (channel.type !== "EMAIL") {
    throw new StatusError(StatusError.BadRequest, `Contact channel type ${channel.type} is not supported on the legacy user contact-channels API.`);
  }
  return {
    // User-backed contacts share their UUID with ProjectUser; API still exposes user_id.
    user_id: channel.contactId,
    id: channel.id,
    type: "email" as const,
    value: channel.value,
    is_primary: !!channel.isPrimary,
    is_verified: channel.isVerified,
    used_for_auth: contactChannelIsUsedForAuth(channel, channel.contactId),
  };
};

export const contactChannelsCrudHandlers = createLazyProxy(() => createCrudHandlers(contactChannelsCrud, {
  querySchema: yupObject({
    user_id: userIdOrMeSchema.optional(),
    contact_channel_id: yupString().uuid().optional(),
  }),
  paramsSchema: yupObject({
    user_id: userIdOrMeSchema.defined().meta({ openapiField: { description: "the user that the contact channel belongs to", exampleValue: 'me', onlyShowInOperations: ["Read", "Update", "Delete"] } }),
    contact_channel_id: yupString().uuid().defined().meta({ openapiField: { description: "the target contact channel", exampleValue: 'b3d396b8-c574-4c80-97b3-50031675ceb2', onlyShowInOperations: ["Read", "Update", "Delete"] } }),
  }),
  onRead: async ({ params, auth }) => {
    if (auth.type === 'client') {
      const currentUserId = auth.user?.id || throwErr(new KnownErrors.CannotGetOwnUserWithoutUser());
      if (currentUserId !== params.user_id) {
        throw new StatusError(StatusError.Forbidden, 'Client can only read contact channels for their own user.');
      }
    }

    const prisma = await getPrismaClientForTenancy(auth.tenancy);

    const contactChannel = await prisma.contactChannel.findUnique({
      where: {
        tenancyId_id: {
          tenancyId: auth.tenancy.id,
          id: params.contact_channel_id || throwErr("Missing contact channel id"),
        },
      },
      include: { authSelections: true },
    });

    if (!contactChannel || contactChannel.contactId !== params.user_id) {
      throw new StatusError(StatusError.NotFound, 'Contact channel not found.');
    }

    return contactChannelToCrud(contactChannel);
  },
  onCreate: async ({ auth, data }) => {
    let value = data.value;
    switch (data.type) {
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      case 'email': {
        value = normalizeEmail(value);
        break;
      }
    }

    if (auth.type === 'client') {
      const currentUserId = auth.user?.id || throwErr(new KnownErrors.CannotGetOwnUserWithoutUser());
      if (currentUserId !== data.user_id) {
        throw new StatusError(StatusError.Forbidden, 'Client can only create contact channels for their own user.');
      }
    }

    const prisma = await getPrismaClientForTenancy(auth.tenancy);

    const contactChannel = await retryTransaction(prisma, async (tx) => {
      await ensureContactChannelDoesNotExists(tx, {
        tenancyId: auth.tenancy.id,
        userId: data.user_id,
        type: data.type,
        value: value,
      });

      // if usedForAuth is set to true, make sure no other account uses this channel for auth
      if (data.used_for_auth) {
        const existingWithSameChannel = await tx.projectUserAuthContactChannel.findUnique({
          where: {
            tenancyId_type_identityScope_value: {
              tenancyId: auth.tenancy.id,
              type: crudContactChannelTypeToPrisma(data.type),
              identityScope: "",
              value: value,
            },
          },
        });
        if (existingWithSameChannel) {
          throw new KnownErrors.ContactChannelAlreadyUsedForAuthBySomeoneElse(data.type, value);
        }
      }

      const createdContactChannel = await tx.contactChannel.create({
        data: {
          tenancyId: auth.tenancy.id,
          contactId: data.user_id,
          type: typedToUppercase(data.type),
          value: value,
          isVerified: data.is_verified ?? false,
          verifiedAt: data.is_verified === true ? new Date() : null,
        },
      });

      if (data.used_for_auth) {
        await setContactChannelUsedForAuth(tx, {
          tenancyId: auth.tenancy.id,
          projectUserId: data.user_id,
          contactChannelId: createdContactChannel.id,
          usedForAuth: true,
        });
      }

      if (data.is_primary) {
        await setContactChannelAsPrimaryById(tx, {
          tenancyId: auth.tenancy.id,
          contactId: data.user_id,
          contactChannelId: createdContactChannel.id,
          type: crudContactChannelTypeToPrisma(data.type),
        });
      }

      await markProjectUserForExternalDbSync(tx, {
        tenancyId: auth.tenancy.id,
        projectUserId: data.user_id,
      });

      return await tx.contactChannel.findUnique({
        where: {
          tenancyId_id: {
            tenancyId: auth.tenancy.id,
            id: createdContactChannel.id,
          },
        },
        include: { authSelections: true },
      }) || throwErr("Failed to create contact channel");
    });

    return contactChannelToCrud(contactChannel);
  },
  onUpdate: async ({ params, auth, data }) => {
    if (auth.type === 'client') {
      const currentUserId = auth.user?.id || throwErr(new KnownErrors.CannotGetOwnUserWithoutUser());
      if (currentUserId !== params.user_id) {
        throw new StatusError(StatusError.Forbidden, 'Client can only update contact channels for their own user.');
      }
    }


    let value = data.value;
    switch (data.type) {
      case 'email': {
        value = value ? normalizeEmail(value) : undefined;
        break;
      }
      case undefined: {
        break;
      }
    }

    const prisma = await getPrismaClientForTenancy(auth.tenancy);

    const updatedContactChannel = await retryTransaction(prisma, async (tx) => {
      const existingContactChannel = await ensureContactChannelExists(tx, {
        tenancyId: auth.tenancy.id,
        userId: params.user_id,
        contactChannelId: params.contact_channel_id || throwErr("Missing contact channel id"),
      });

      // if usedForAuth is set to true, make sure no other account uses this channel for auth
      if (data.used_for_auth) {
        const existingWithSameChannel = await tx.projectUserAuthContactChannel.findUnique({
          where: {
            tenancyId_type_identityScope_value: {
              tenancyId: auth.tenancy.id,
              type: data.type !== undefined ? crudContactChannelTypeToPrisma(data.type) : existingContactChannel.type,
              identityScope: existingContactChannel.identityScope,
              value: value !== undefined ? value : existingContactChannel.value,
            },
          },
        });
        if (existingWithSameChannel && existingWithSameChannel.contactChannelId !== existingContactChannel.id) {
          if (existingContactChannel.type !== "EMAIL") {
            throw new StatusError(StatusError.BadRequest, `Contact channel type ${existingContactChannel.type} is not supported on the legacy user contact-channels API.`);
          }
          throw new KnownErrors.ContactChannelAlreadyUsedForAuthBySomeoneElse(data.type ?? prismaContactChannelTypeToCrud(existingContactChannel.type));
        }
      }

      if (data.is_primary) {
        await demoteAllContactChannelsToNonPrimary(tx, {
          tenancyId: auth.tenancy.id,
          contactId: params.user_id,
          type: data.type !== undefined ? crudContactChannelTypeToPrisma(data.type) : existingContactChannel.type,
        });
      }

      const updated = await tx.contactChannel.update({
        where: {
          tenancyId_id: {
            tenancyId: auth.tenancy.id,
            id: params.contact_channel_id || throwErr("Missing contact channel id"),
          },
        },
        data: withExternalDbSyncUpdate({
          value: value,
          isVerified: data.is_verified ?? (value ? false : undefined), // if value is updated and is_verified is not provided, set to false
          verifiedAt: data.is_verified === true
            ? (existingContactChannel.verifiedAt ?? new Date())
            : data.is_verified === false || value
              ? null
              : undefined,
          isPrimary: data.is_primary !== undefined ? (data.is_primary ? 'TRUE' : null) : undefined,
        }),
        include: { authSelections: true },
      });

      if (updated.contactId !== params.user_id) {
        throw new StatusError(StatusError.NotFound, 'Contact channel not found.');
      }

      if (data.used_for_auth !== undefined) {
        await setContactChannelUsedForAuth(tx, {
          tenancyId: auth.tenancy.id,
          projectUserId: params.user_id,
          contactChannelId: updated.id,
          usedForAuth: data.used_for_auth,
        });
      }

      await markProjectUserForExternalDbSync(tx, {
        tenancyId: auth.tenancy.id,
        projectUserId: params.user_id,
      });

      return await tx.contactChannel.findUnique({
        where: {
          tenancyId_id: {
            tenancyId: auth.tenancy.id,
            id: updated.id,
          },
        },
        include: { authSelections: true },
      }) ?? throwErr("Contact channel missing after update");
    });

    return contactChannelToCrud(updatedContactChannel);
  },
  onDelete: async ({ params, auth }) => {
    if (auth.type === 'client') {
      const currentUserId = auth.user?.id || throwErr(new KnownErrors.CannotGetOwnUserWithoutUser());
      if (currentUserId !== params.user_id) {
        throw new StatusError(StatusError.Forbidden, 'Client can only delete contact channels for their own user.');
      }
    }

    const prisma = await getPrismaClientForTenancy(auth.tenancy);

    await retryTransaction(prisma, async (tx) => {
      await ensureContactChannelExists(tx, {
        tenancyId: auth.tenancy.id,
        userId: params.user_id,
        contactChannelId: params.contact_channel_id || throwErr("Missing contact channel id"),
      });

      await recordExternalDbSyncDeletion(tx, {
        tableName: "ContactChannel",
        tenancyId: auth.tenancy.id,
        projectUserId: params.user_id,
        contactChannelId: params.contact_channel_id || throwErr("Missing contact channel id"),
      });

      await tx.contactChannel.delete({
        where: {
          tenancyId_id: {
            tenancyId: auth.tenancy.id,
            id: params.contact_channel_id || throwErr("Missing contact channel id"),
          },
        },
      });

      await markProjectUserForExternalDbSync(tx, {
        tenancyId: auth.tenancy.id,
        projectUserId: params.user_id,
      });
    });
  },
  onList: async ({ query, auth }) => {
    if (auth.type === 'client') {
      const currentUserId = auth.user?.id || throwErr(new KnownErrors.CannotGetOwnUserWithoutUser());
      if (currentUserId !== query.user_id) {
        throw new StatusError(StatusError.Forbidden, 'Client can only list contact channels for their own user.');
      }
    }

    const prisma = await getPrismaClientForTenancy(auth.tenancy);

    const contactChannels = await prisma.contactChannel.findMany({
      where: {
        tenancyId: auth.tenancy.id,
        contactId: query.user_id,
        id: query.contact_channel_id,
        type: "EMAIL",
      },
      include: { authSelections: true },
    });

    return {
      items: contactChannels.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()).map(contactChannelToCrud),
      is_paginated: false,
    };
  }
}));


function crudContactChannelTypeToPrisma(type: "email") {
  return typedToUppercase(type);
}

function prismaContactChannelTypeToCrud(type: "EMAIL") {
  return typedToLowercase(type);
}
