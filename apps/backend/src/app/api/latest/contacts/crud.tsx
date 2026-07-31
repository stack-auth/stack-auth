import {
  createContact,
  deleteContact,
  getContact,
  listContacts,
  updateContact,
} from "@/lib/comms/contacts";
import { getPrismaClientForTenancy, retryTransaction } from "@/prisma-client";
import { createCrudHandlers } from "@/route-handlers/crud-handler";
import { contactsCrud } from "@hexclave/shared/dist/interface/crud/contacts";
import { yupObject, yupString } from "@hexclave/shared/dist/schema-fields";
import { StatusError } from "@hexclave/shared/dist/utils/errors";
import { createLazyProxy } from "@hexclave/shared/dist/utils/proxies";

const MAX_LIMIT = 200;

export const contactsCrudHandlers = createLazyProxy(() => createCrudHandlers(contactsCrud, {
  paramsSchema: yupObject({
    contact_id: yupString().uuid().defined().meta({
      openapiField: {
        description: "The contact ID",
        exampleValue: "b3d396b8-c574-4c80-97b3-50031675ceb2",
        onlyShowInOperations: ["Read", "Update", "Delete"],
      },
    }),
  }),
  querySchema: yupObject({
    cursor: yupString().uuid().optional().meta({
      openapiField: {
        onlyShowInOperations: ["List"],
        description: "Cursor for pagination (contact ID). Results are ordered by ID ascending.",
      },
    }),
    limit: yupString().optional().meta({
      openapiField: {
        onlyShowInOperations: ["List"],
        description: `Maximum number of contacts to return (1–${MAX_LIMIT}). Defaults to 50.`,
      },
    }),
    include_merged: yupString().oneOf(["true", "false"]).optional().meta({
      openapiField: {
        onlyShowInOperations: ["List"],
        description: "When true, includes contacts that have been merged into another contact. Defaults to false.",
      },
    }),
  }),
  onCreate: async ({ auth, data }) => {
    const prisma = await getPrismaClientForTenancy(auth.tenancy);
    return await retryTransaction(prisma, async (tx) => {
      return await createContact(tx, {
        tenancyId: auth.tenancy.id,
        data,
      });
    });
  },
  onRead: async ({ auth, params }) => {
    const prisma = await getPrismaClientForTenancy(auth.tenancy);
    const contact = await retryTransaction(prisma, async (tx) => {
      return await getContact(tx, {
        tenancyId: auth.tenancy.id,
        contactId: params.contact_id,
      });
    });
    if (contact == null) {
      throw new StatusError(StatusError.NotFound, "Contact not found");
    }
    return contact;
  },
  onUpdate: async ({ auth, params, data }) => {
    const prisma = await getPrismaClientForTenancy(auth.tenancy);
    return await retryTransaction(prisma, async (tx) => {
      return await updateContact(tx, {
        tenancyId: auth.tenancy.id,
        contactId: params.contact_id,
        data,
      });
    });
  },
  onDelete: async ({ auth, params }) => {
    const prisma = await getPrismaClientForTenancy(auth.tenancy);
    await retryTransaction(prisma, async (tx) => {
      await deleteContact(tx, {
        tenancyId: auth.tenancy.id,
        contactId: params.contact_id,
      });
    });
  },
  onList: async ({ auth, query }) => {
    const parsedLimit = query.limit == null ? 50 : Number(query.limit);
    if (!Number.isInteger(parsedLimit) || parsedLimit < 1) {
      throw new StatusError(StatusError.BadRequest, "Limit must be a positive integer");
    }
    if (parsedLimit > MAX_LIMIT) {
      throw new StatusError(StatusError.BadRequest, `Limit cannot exceed ${MAX_LIMIT}`);
    }

    const prisma = await getPrismaClientForTenancy(auth.tenancy);
    const { contacts, nextCursor } = await retryTransaction(prisma, async (tx) => {
      return await listContacts(tx, {
        tenancyId: auth.tenancy.id,
        cursor: query.cursor,
        limit: parsedLimit,
        includeMerged: query.include_merged === "true",
      });
    });

    return {
      items: contacts,
      is_paginated: true,
      pagination: {
        next_cursor: nextCursor,
      },
    };
  },
}));
