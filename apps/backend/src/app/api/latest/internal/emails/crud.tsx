import { prismaClient } from "@/prisma-client";
import { createCrudHandlers } from "@/route-handlers/crud-handler";
import { SentEmail } from "@prisma/client";
import { InternalEmailsCrud, internalEmailsCrud } from "@stackframe/stack-shared/dist/interface/crud/emails";
import { projectIdSchema, yupObject } from "@stackframe/stack-shared/dist/schema-fields";
import { createLazyProxy } from "@stackframe/stack-shared/dist/utils/proxies";

function prismaModelToCrud(prismaModel: SentEmail): InternalEmailsCrud["Admin"]["Read"] {

  return {
    id: prismaModel.id,
    subject: prismaModel.subject,
    sent_at_millis: prismaModel.createdAt.getTime(),
    to: prismaModel.to,
    sender_config: prismaModel.senderConfig,
    error: prismaModel.error,
  };
}


export const internalEmailsCrudHandlers = createLazyProxy(() => createCrudHandlers(internalEmailsCrud, {
  paramsSchema: yupObject({
    projectId: projectIdSchema.defined(),
  }),
  onList: async ({ params }) => {
    const emails = await prismaClient.sentEmail.findMany({
      where: {
        tenancy: {
          projectId: params.projectId,
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    return {
      items: emails.map(x => prismaModelToCrud(x)),
      is_paginated: false,
    };
  }
}));
