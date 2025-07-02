import { getPrismaClientForTenancy } from "@/prisma-client";
import { createCrudHandlers } from "@/route-handlers/crud-handler";
import { SentEmail } from "@prisma/client";
import { InternalEmailsCrud, internalEmailsCrud } from "@stackframe/stack-shared/dist/interface/crud/emails";
import { yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { createLazyProxy } from "@stackframe/stack-shared/dist/utils/proxies";

function prismaModelToCrud(prismaModel: SentEmail): InternalEmailsCrud["Admin"]["Read"] {
  const senderConfig = prismaModel.senderConfig as any;

  return {
    id: prismaModel.id,
    subject: prismaModel.subject,
    sent_at_millis: prismaModel.createdAt.getTime(),
    to: prismaModel.to,
    sender_config: {
      type: senderConfig.type,
      host: senderConfig.host,
      port: senderConfig.port,
      username: senderConfig.username,
      sender_name: senderConfig.senderName,
      sender_email: senderConfig.senderEmail,
    },
    error: prismaModel.error,
  };
}


export const internalEmailsCrudHandlers = createLazyProxy(() => createCrudHandlers(internalEmailsCrud, {
  paramsSchema: yupObject({
    emailId: yupString().optional(),
  }),
  onList: async ({ auth }) => {
    const emails = await getPrismaClientForTenancy(auth.tenancy).sentEmail.findMany({
      where: {
        tenancyId: auth.tenancy.id,
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: 100,
    });

    return {
      items: emails.map(x => prismaModelToCrud(x)),
      is_paginated: false,
    };
  }
}));
