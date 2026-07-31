import {
  createContactChannel,
  deleteContactChannel,
  getContactChannel,
  listContactChannels,
  updateContactChannel,
} from "@/lib/comms/contacts";
import { getPrismaClientForTenancy, retryTransaction } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import {
  contactChannelSchema,
  contactChannelUpdateSchema,
  contactChannelWriteSchema,
} from "@hexclave/shared/dist/interface/comms";
import {
  adaptSchema,
  serverOrHigherAuthTypeSchema,
  yupArray,
  yupBoolean,
  yupNumber,
  yupObject,
  yupString,
} from "@hexclave/shared/dist/schema-fields";
import { StatusError } from "@hexclave/shared/dist/utils/errors";

export const GET = createSmartRouteHandler({
  metadata: {
    summary: "List contact channels",
    description: "Lists all channels for a contact.",
    tags: ["Contacts"],
  },
  request: yupObject({
    auth: yupObject({
      type: serverOrHigherAuthTypeSchema,
      tenancy: adaptSchema.defined(),
    }).defined(),
    params: yupObject({
      contact_id: yupString().uuid().defined(),
    }).defined(),
    method: yupString().oneOf(["GET"]).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      is_paginated: yupBoolean().oneOf([false]).defined(),
      items: yupArray(contactChannelSchema).defined(),
    }).defined(),
  }),
  handler: async ({ auth, params }) => {
    const prisma = await getPrismaClientForTenancy(auth.tenancy);
    const items = await retryTransaction(prisma, async (tx) => {
      return await listContactChannels(tx, {
        tenancyId: auth.tenancy.id,
        contactId: params.contact_id,
      });
    });
    return {
      statusCode: 200 as const,
      bodyType: "json" as const,
      body: {
        is_paginated: false as const,
        items,
      },
    };
  },
});

export const POST = createSmartRouteHandler({
  metadata: {
    summary: "Create contact channel",
    description: "Adds a channel to a contact. Exact duplicate identities across contacts are allowed.",
    tags: ["Contacts"],
  },
  request: yupObject({
    auth: yupObject({
      type: serverOrHigherAuthTypeSchema,
      tenancy: adaptSchema.defined(),
    }).defined(),
    params: yupObject({
      contact_id: yupString().uuid().defined(),
    }).defined(),
    body: contactChannelWriteSchema,
    method: yupString().oneOf(["POST"]).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([201]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: contactChannelSchema,
  }),
  handler: async ({ auth, params, body }) => {
    const prisma = await getPrismaClientForTenancy(auth.tenancy);
    const channel = await retryTransaction(prisma, async (tx) => {
      return await createContactChannel(tx, {
        tenancyId: auth.tenancy.id,
        contactId: params.contact_id,
        channel: body,
      });
    });
    return {
      statusCode: 201 as const,
      bodyType: "json" as const,
      body: channel,
    };
  },
});

export const channelByIdHandlers = {
  GET: createSmartRouteHandler({
    metadata: {
      summary: "Get contact channel",
      description: "Gets a single channel on a contact.",
      tags: ["Contacts"],
    },
    request: yupObject({
      auth: yupObject({
        type: serverOrHigherAuthTypeSchema,
        tenancy: adaptSchema.defined(),
      }).defined(),
      params: yupObject({
        contact_id: yupString().uuid().defined(),
        channel_id: yupString().uuid().defined(),
      }).defined(),
      method: yupString().oneOf(["GET"]).defined(),
    }),
    response: yupObject({
      statusCode: yupNumber().oneOf([200]).defined(),
      bodyType: yupString().oneOf(["json"]).defined(),
      body: contactChannelSchema,
    }),
    handler: async ({ auth, params }) => {
      const prisma = await getPrismaClientForTenancy(auth.tenancy);
      const channel = await retryTransaction(prisma, async (tx) => {
        return await getContactChannel(tx, {
          tenancyId: auth.tenancy.id,
          contactId: params.contact_id,
          channelId: params.channel_id,
        });
      });
      if (channel == null) {
        throw new StatusError(StatusError.NotFound, "Contact channel not found");
      }
      return {
        statusCode: 200 as const,
        bodyType: "json" as const,
        body: channel,
      };
    },
  }),

  PATCH: createSmartRouteHandler({
    metadata: {
      summary: "Update contact channel",
      description: "Updates primary/verified/metadata (and phone extension) on a contact channel. Identity value changes are not supported; delete and recreate instead.",
      tags: ["Contacts"],
    },
    request: yupObject({
      auth: yupObject({
        type: serverOrHigherAuthTypeSchema,
        tenancy: adaptSchema.defined(),
      }).defined(),
      params: yupObject({
        contact_id: yupString().uuid().defined(),
        channel_id: yupString().uuid().defined(),
      }).defined(),
      body: contactChannelUpdateSchema,
      method: yupString().oneOf(["PATCH"]).defined(),
    }),
    response: yupObject({
      statusCode: yupNumber().oneOf([200]).defined(),
      bodyType: yupString().oneOf(["json"]).defined(),
      body: contactChannelSchema,
    }),
    handler: async ({ auth, params, body }) => {
      const prisma = await getPrismaClientForTenancy(auth.tenancy);
      const channel = await retryTransaction(prisma, async (tx) => {
        return await updateContactChannel(tx, {
          tenancyId: auth.tenancy.id,
          contactId: params.contact_id,
          channelId: params.channel_id,
          data: body,
        });
      });
      return {
        statusCode: 200 as const,
        bodyType: "json" as const,
        body: channel,
      };
    },
  }),

  DELETE: createSmartRouteHandler({
    metadata: {
      summary: "Delete contact channel",
      description: "Deletes a channel from a contact. Auth selections that reference the channel cascade with the channel row.",
      tags: ["Contacts"],
    },
    request: yupObject({
      auth: yupObject({
        type: serverOrHigherAuthTypeSchema,
        tenancy: adaptSchema.defined(),
      }).defined(),
      params: yupObject({
        contact_id: yupString().uuid().defined(),
        channel_id: yupString().uuid().defined(),
      }).defined(),
      method: yupString().oneOf(["DELETE"]).defined(),
    }),
    response: yupObject({
      statusCode: yupNumber().oneOf([200]).defined(),
      bodyType: yupString().oneOf(["success"]).defined(),
    }),
    handler: async ({ auth, params }) => {
      const prisma = await getPrismaClientForTenancy(auth.tenancy);
      await retryTransaction(prisma, async (tx) => {
        await deleteContactChannel(tx, {
          tenancyId: auth.tenancy.id,
          contactId: params.contact_id,
          channelId: params.channel_id,
        });
      });
      return {
        statusCode: 200 as const,
        bodyType: "success" as const,
      };
    },
  }),
};
