import { refundTransaction } from "@/lib/payments/ledger/transactions";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { moneyAmountSchema } from "@stackframe/stack-shared/dist/schema-fields";
import { SUPPORTED_CURRENCIES, type MoneyAmount } from "@stackframe/stack-shared/dist/utils/currency-constants";
import { throwErr } from "@stackframe/stack-shared/dist/utils/errors";
import { adaptSchema, adminAuthTypeSchema, yupArray, yupBoolean, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";

const USD_CURRENCY = SUPPORTED_CURRENCIES.find((currency) => currency.code === "USD")
  ?? throwErr("USD currency configuration missing in SUPPORTED_CURRENCIES");

export const POST = createSmartRouteHandler({
  metadata: {
    hidden: true,
  },
  request: yupObject({
    auth: yupObject({
      type: adminAuthTypeSchema.defined(),
      project: adaptSchema.defined(),
      tenancy: adaptSchema.defined(),
    }).defined(),
    body: yupObject({
      type: yupString().oneOf(["subscription", "one-time-purchase"]).defined(),
      id: yupString().defined(),
      refund_entries: yupArray(
        yupObject({
          entry_index: yupNumber().integer().defined(),
          quantity: yupNumber().integer().defined(),
          amount_usd: moneyAmountSchema(USD_CURRENCY).defined(),
        }).defined(),
      ).defined(),
    }).defined()
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      success: yupBoolean().defined(),
    }).defined(),
  }),
  handler: async ({ auth, body }) => {
    await refundTransaction({
      tenancy: auth.tenancy,
      type: body.type,
      id: body.id,
      refundEntries: body.refund_entries.map((entry) => ({
        ...entry,
        amount_usd: entry.amount_usd as MoneyAmount,
      })),
    });

    return {
      statusCode: 200,
      bodyType: "json",
      body: { success: true },
    };
  },
});
