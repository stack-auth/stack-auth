import { getPrismaClientForTenancy } from "@/prisma-client";
import { createCrudHandlers } from "@/route-handlers/crud-handler";
import { EmailOutbox } from "@prisma/client";
import { InternalEmailsCrud, internalEmailsCrud } from "@stackframe/stack-shared/dist/interface/crud/emails";
import { yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { createLazyProxy } from "@stackframe/stack-shared/dist/utils/proxies";

function prismaModelToCrud(prismaModel: EmailOutbox): InternalEmailsCrud["Admin"]["Read"] {
  const recipient = prismaModel.to as any;
  let to: string[] = [];
  if (recipient?.type === 'user-primary-email') {
    to = [`User ID: ${recipient.userId}`];
  } else if (recipient?.type === 'user-custom-emails' || recipient?.type === 'custom-emails') {
    to = Array.isArray(recipient.emails) ? recipient.emails : [];
  }

  let error: string | null = null;
  if (prismaModel.renderErrorExternalMessage) error = `Render error: ${prismaModel.renderErrorExternalMessage}`;
  else if (prismaModel.sendServerErrorExternalMessage) error = `Send error: ${prismaModel.sendServerErrorExternalMessage}`;

  return {
    id: prismaModel.id,
    subject: prismaModel.renderedSubject ?? "",
    sent_at_millis: (prismaModel.finishedSendingAt ?? prismaModel.createdAt).getTime(),
    to,
    error: error,
  };
}


export const internalEmailsCrudHandlers = createLazyProxy(() => createCrudHandlers(internalEmailsCrud, {
  paramsSchema: yupObject({
    emailId: yupString().optional(),
  }),
  onList: async ({ auth }) => {
    const prisma = await getPrismaClientForTenancy(auth.tenancy);

    const emails = await prisma.emailOutbox.findMany({
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
