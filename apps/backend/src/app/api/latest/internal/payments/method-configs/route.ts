import { getStackStripe } from "@/lib/stripe";
import { globalPrismaClient } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { KnownErrors } from "@stackframe/stack-shared";
import { adaptSchema, adminAuthTypeSchema, yupArray, yupBoolean, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { stringCompare } from "@stackframe/stack-shared/dist/utils/strings";

// Human-readable names for payment methods
const PAYMENT_METHOD_DISPLAY_NAMES: Record<string, string> = {
  card: "Credit/Debit Card",
  apple_pay: "Apple Pay",
  google_pay: "Google Pay",
  klarna: "Klarna",
  affirm: "Affirm",
  afterpay_clearpay: "Afterpay / Clearpay",
  alipay: "Alipay",
  amazon_pay: "Amazon Pay",
  link: "Link",
  cashapp: "Cash App",
  acss_debit: "ACSS Debit",
  bacs_debit: "Bacs Direct Debit",
  bancontact: "Bancontact",
  blik: "BLIK",
  cartes_bancaires: "Cartes Bancaires",
  customer_balance: "Customer Balance",
  eps: "EPS",
  giropay: "Giropay",
  ideal: "iDEAL",
  multibanco: "Multibanco",
  p24: "Przelewy24",
  sepa_debit: "SEPA Direct Debit",
  sofort: "Sofort",
  us_bank_account: "US Bank Account",
  wechat_pay: "WeChat Pay",
  zip: "Zip",
};

// Fields that are metadata, not payment methods
const METADATA_FIELDS = new Set([
  'id', 'object', 'active', 'application', 'is_default', 'livemode', 'name', 'parent'
]);

export const GET = createSmartRouteHandler({
  metadata: {
    hidden: true,
  },
  request: yupObject({
    auth: yupObject({
      type: adminAuthTypeSchema.defined(),
      project: adaptSchema.defined(),
      tenancy: adaptSchema.defined(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      configId: yupString().defined(),
      methods: yupArray(yupObject({
        id: yupString().defined(),
        name: yupString().defined(),
        enabled: yupBoolean().defined(),
        available: yupBoolean().defined(),
      })).defined(),
    }).defined(),
  }),
  handler: async ({ auth }) => {
    const project = await globalPrismaClient.project.findUnique({
      where: { id: auth.project.id },
      select: { stripeAccountId: true },
    });

    if (!project?.stripeAccountId) {
      throw new KnownErrors.StripeAccountInfoNotFound();
    }

    const stripe = getStackStripe();
    const configs = await stripe.paymentMethodConfigurations.list({}, {
      stripeAccount: project.stripeAccountId,
    });

    // Find the default configuration
    const defaultConfig = configs.data.find(c => c.is_default);
    if (!defaultConfig) {
      throw new Error("No default payment method configuration found");
    }

    // Transform to simplified format
    const methods = Object.entries(defaultConfig)
      .filter(([key]) => !METADATA_FIELDS.has(key))
      .filter(([, value]) => value && typeof value === 'object' && 'display_preference' in value)
      .map(([id, config]) => ({
        id,
        name: PAYMENT_METHOD_DISPLAY_NAMES[id] || id,
        enabled: (config as any).display_preference?.value === 'on',
        available: (config as any).available || false,
      }))
      .sort((a, b) => {
        // Sort: available first, then alphabetically
        if (a.available !== b.available) return b.available ? 1 : -1;
        return stringCompare(a.name, b.name);
      });

    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        configId: defaultConfig.id,
        methods,
      },
    };
  },
});
