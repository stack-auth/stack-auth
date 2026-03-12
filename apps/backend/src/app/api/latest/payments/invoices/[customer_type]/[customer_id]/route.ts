import { Prisma } from "@/generated/prisma/client";
import { ensureClientCanAccessCustomer } from "@/lib/payments/index";
import { getPrismaClientForTenancy } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { customerInvoicesListResponseSchema } from "@stackframe/stack-shared/dist/interface/crud/invoices";
import { adaptSchema, clientOrHigherAuthTypeSchema, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { StatusError } from "@stackframe/stack-shared/dist/utils/errors";
import { typedToUppercase } from "@stackframe/stack-shared/dist/utils/strings";

export const GET = createSmartRouteHandler({
  metadata: {
    summary: "List invoices for a customer",
    hidden: true,
    tags: ["Payments"],
  },
  request: yupObject({
    auth: yupObject({
      type: clientOrHigherAuthTypeSchema.defined(),
      project: adaptSchema.defined(),
      tenancy: adaptSchema.defined(),
    }).defined(),
    params: yupObject({
      customer_type: yupString().oneOf(["user", "team"]).defined(),
      customer_id: yupString().defined(),
    }).defined(),
    query: yupObject({
      cursor: yupString().optional(),
      limit: yupString().optional(),
    }).default(() => ({})).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: customerInvoicesListResponseSchema,
  }),
  handler: async ({ auth, params, query }, fullReq) => {
    if (auth.type === "client") {
      await ensureClientCanAccessCustomer({
        customerType: params.customer_type,
        customerId: params.customer_id,
        user: fullReq.auth?.user,
        tenancy: auth.tenancy,
        forbiddenMessage: "Clients can only manage their own billing.",
      });
    }

    const prisma = await getPrismaClientForTenancy(auth.tenancy);
    const limit = yupNumber().min(1).max(100).optional().default(10).validateSync(query.limit);
    const cursorId = query.cursor;
    let paginationWhere: Prisma.SubscriptionInvoiceWhereInput | undefined;
    if (cursorId) {
      const pivot = await prisma.subscriptionInvoice.findUnique({
        where: {
          tenancyId_id: {
            tenancyId: auth.tenancy.id,
            id: cursorId,
          },
        },
        select: { createdAt: true },
      });
      if (!pivot) {
        throw new StatusError(400, "Invalid cursor");
      }
      paginationWhere = {
        OR: [
          { createdAt: { lt: pivot.createdAt } },
          { AND: [{ createdAt: { equals: pivot.createdAt } }, { id: { lt: cursorId } }] },
        ],
      };
    }

    const customerType = typedToUppercase(params.customer_type);
    const invoices = await prisma.subscriptionInvoice.findMany({
      where: {
        tenancyId: auth.tenancy.id,
        ...(paginationWhere ?? {}),
        subscription: {
          customerType,
          customerId: params.customer_id,
        },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit,
    });

    const invoiceStatuses = ["draft", "open", "paid", "uncollectible", "void"] as const;
    type InvoiceStatus = (typeof invoiceStatuses)[number];
    const allowedStatuses: ReadonlySet<InvoiceStatus> = new Set(invoiceStatuses);
    const isInvoiceStatus = (value: string | null): value is InvoiceStatus => {
      if (value === null) {
        return false;
      }
      return allowedStatuses.has(value as InvoiceStatus);
    };

    const items = invoices.map((invoice) => {
      const status = isInvoiceStatus(invoice.status) ? invoice.status : null;
      return {
        created_at_millis: invoice.createdAt.getTime(),
        status,
        amount_total: invoice.amountTotal ?? 0,
        hosted_invoice_url: invoice.hostedInvoiceUrl ?? null,
      };
    });

    const nextCursor = invoices.length === limit ? invoices[invoices.length - 1].id : null;

    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        items,
        is_paginated: true,
        pagination: {
          next_cursor: nextCursor,
        },
      },
    };
  },
});
