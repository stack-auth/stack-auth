import { normalizeEmail } from "@/lib/emails";
import { ensureContactChannelDoesNotExists, ensureContactChannelExists } from "@/lib/request-checks";
import { getPrismaClientForTenancy, retryTransaction } from "@/prisma-client";
import { createCrudHandlers } from "@/route-handlers/crud-handler";
import { Prisma } from "@prisma/client";
import { KnownErrors } from "@stackframe/stack-shared";
import { contactChannelsCrud } from "@stackframe/stack-shared/dist/interface/crud/contact-channels";
import { userIdOrMeSchema, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { StatusError, throwErr } from "@stackframe/stack-shared/dist/utils/errors";
import { createLazyProxy } from "@stackframe/stack-shared/dist/utils/proxies";
import { typedToLowercase, typedToUppercase } from "@stackframe/stack-shared/dist/utils/strings";

export const contactChannelToCrud = (channel: Prisma.ContactChannelGetPayload<{}>) => {
  return {
    user_id: channel.projectUserId,
    id: channel.id,
    type: typedToLowercase(channel.type),
    value: channel.value,
    is_primary: !!channel.isPrimary,
    is_verified: channel.isVerified,
    used_for_auth: !!channel.usedForAuth,
  } as const;
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

    const contactChannel = await getPrismaClientForTenancy(auth.tenancy).contactChannel.findUnique({
      where: {
        tenancyId_projectUserId_id: {
          tenancyId: auth.tenancy.id,
          projectUserId: params.user_id,
          id: params.contact_channel_id || throwErr("Missing contact channel id"),
        },
      },
    });

    if (!contactChannel) {
      throw new StatusError(StatusError.NotFound, 'Contact channel not found.');
    }

    return contactChannelToCrud(contactChannel);
  },
  onCreate: async ({ auth, data }) => {
    let value = data.value;
    switch (data.type) {
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

    const contactChannel = await retryTransaction(getPrismaClientForTenancy(auth.tenancy), async (tx) => {
      await ensureContactChannelDoesNotExists(tx, {
        tenancyId: auth.tenancy.id,
        userId: data.user_id,
        type: data.type,
        value: value,
      });

      // if usedForAuth is set to true, make sure no other account uses this channel for auth
      if (data.used_for_auth) {
        const existingWithSameChannel = await tx.contactChannel.findUnique({
          where: {
            tenancyId_type_value_usedForAuth: {
              tenancyId: auth.tenancy.id,
              type: crudContactChannelTypeToPrisma(data.type),
              value: value,
              usedForAuth: 'TRUE',
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
          projectUserId: data.user_id,
          type: typedToUppercase(data.type),
          value: value,
          isVerified: data.is_verified ?? false,
          usedForAuth: data.used_for_auth ? 'TRUE' : null,
        },
      });

      if (data.is_primary) {
        // mark all other channels as not primary
        await tx.contactChannel.updateMany({
          where: {
            tenancyId: auth.tenancy.id,
            projectUserId: data.user_id,
          },
          data: {
            isPrimary: null,
          },
        });

        await tx.contactChannel.update({
          where: {
            tenancyId_projectUserId_id: {
              tenancyId: auth.tenancy.id,
              projectUserId: data.user_id,
              id: createdContactChannel.id,
            },
          },
          data: {
            isPrimary: 'TRUE',
          },
        });
      }

      return await tx.contactChannel.findUnique({
        where: {
          tenancyId_projectUserId_id: {
            tenancyId: auth.tenancy.id,
            projectUserId: data.user_id,
            id: createdContactChannel.id,
          },
        },
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

    const updatedContactChannel = await retryTransaction(getPrismaClientForTenancy(auth.tenancy), async (tx) => {
      const existingContactChannel = await ensureContactChannelExists(tx, {
        tenancyId: auth.tenancy.id,
        userId: params.user_id,
        contactChannelId: params.contact_channel_id || throwErr("Missing contact channel id"),
      });

      // if usedForAuth is set to true, make sure no other account uses this channel for auth
      if (data.used_for_auth) {
        const existingWithSameChannel = await tx.contactChannel.findUnique({
          where: {
            tenancyId_type_value_usedForAuth: {
              tenancyId: auth.tenancy.id,
              type: data.type !== undefined ? crudContactChannelTypeToPrisma(data.type) : existingContactChannel.type,
              value: value !== undefined ? value : existingContactChannel.value,
              usedForAuth: 'TRUE',
            },
          },
        });
        if (existingWithSameChannel && existingWithSameChannel.id !== existingContactChannel.id) {
          throw new KnownErrors.ContactChannelAlreadyUsedForAuthBySomeoneElse(data.type ?? prismaContactChannelTypeToCrud(existingContactChannel.type));
        }
      }

      if (data.is_primary) {
        // mark all other channels as not primary
        await tx.contactChannel.updateMany({
          where: {
            tenancyId: auth.tenancy.id,
            projectUserId: params.user_id,
          },
          data: {
            isPrimary: null,
          },
        });
      }

      return await tx.contactChannel.update({
        where: {
          tenancyId_projectUserId_id: {
            tenancyId: auth.tenancy.id,
            projectUserId: params.user_id,
            id: params.contact_channel_id || throwErr("Missing contact channel id"),
          },
        },
        data: {
          value: value,
          isVerified: data.is_verified ?? (value ? false : undefined), // if value is updated and is_verified is not provided, set to false
          usedForAuth: data.used_for_auth !== undefined ? (data.used_for_auth ? 'TRUE' : null) : undefined,
          isPrimary: data.is_primary !== undefined ? (data.is_primary ? 'TRUE' : null) : undefined,
        },
      });
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

    await retryTransaction(getPrismaClientForTenancy(auth.tenancy), async (tx) => {
      await ensureContactChannelExists(tx, {
        tenancyId: auth.tenancy.id,
        userId: params.user_id,
        contactChannelId: params.contact_channel_id || throwErr("Missing contact channel id"),
      });

      await tx.contactChannel.delete({
        where: {
          tenancyId_projectUserId_id: {
            tenancyId: auth.tenancy.id,
            projectUserId: params.user_id,
            id: params.contact_channel_id || throwErr("Missing contact channel id"),
          },
        },
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

    const contactChannels = await getPrismaClientForTenancy(auth.tenancy).contactChannel.findMany({
      where: {
        tenancyId: auth.tenancy.id,
        projectUserId: query.user_id,
        id: query.contact_channel_id,
      },
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
