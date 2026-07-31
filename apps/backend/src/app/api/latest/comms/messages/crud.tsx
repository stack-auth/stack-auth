import {
  getMessage,
  ingestMessage,
} from "@/lib/comms/messages";
import { getPrismaClientForTenancy, retryTransaction } from "@/prisma-client";
import { createCrudHandlers } from "@/route-handlers/crud-handler";
import { commsMessagesCrud } from "@hexclave/shared/dist/interface/crud/comms-messages";
import { yupObject, yupString } from "@hexclave/shared/dist/schema-fields";
import { StatusError } from "@hexclave/shared/dist/utils/errors";
import { createLazyProxy } from "@hexclave/shared/dist/utils/proxies";

export const commsMessagesCrudHandlers = createLazyProxy(() => createCrudHandlers(commsMessagesCrud, {
  paramsSchema: yupObject({
    message_id: yupString().uuid().defined().meta({
      openapiField: {
        description: "The message ID",
        exampleValue: "b3d396b8-c574-4c80-97b3-50031675ceb2",
        onlyShowInOperations: ["Read"],
      },
    }),
  }),
  onCreate: async ({ auth, data }) => {
    const prisma = await getPrismaClientForTenancy(auth.tenancy);
    const result = await retryTransaction(prisma, async (tx) => {
      return await ingestMessage(tx, {
        tenancyId: auth.tenancy.id,
        data,
      });
    });
    return result.message;
  },
  onRead: async ({ auth, params }) => {
    const prisma = await getPrismaClientForTenancy(auth.tenancy);
    const message = await retryTransaction(prisma, async (tx) => {
      return await getMessage(tx, {
        tenancyId: auth.tenancy.id,
        messageId: params.message_id,
      });
    });
    if (message == null) {
      throw new StatusError(StatusError.NotFound, "Message not found");
    }
    return message;
  },
}));
