import { getStackStripe } from "@/lib/stripe";
import { globalPrismaClient } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { KnownErrors } from "@stackframe/stack-shared";
import { adaptSchema, adminAuthTypeSchema, yupArray, yupBoolean, yupNumber, yupObject, yupRecord, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { StackAssertionError } from "@stackframe/stack-shared/dist/utils/errors";
import { has } from "@stackframe/stack-shared/dist/utils/objects";
import { stringCompare } from "@stackframe/stack-shared/dist/utils/strings";

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
      config_id: yupString().defined(),
      methods: yupArray(yupObject({
        id: yupString().defined(),
        name: yupString().oneOf(Object.values(PAYMENT_METHOD_DISPLAY_NAMES)).defined(),
        enabled: yupBoolean().defined(),
        available: yupBoolean().defined(),
        overridable: yupBoolean().defined(),
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


    const platformConfig = configs.data.find(c => c.application || c.parent);
    const defaultConfig = platformConfig || configs.data.find(c => c.is_default);
    if (!defaultConfig) {
      throw new StackAssertionError("No payment method configuration found for Stripe account", {
        stripeAccountId: project.stripeAccountId,
        configCount: configs.data.length,
      });
    }

    console.log("[method-configs] Stripe account:", project.stripeAccountId);
    console.log("[method-configs] Using config:", defaultConfig.id, "application:", defaultConfig.application, "parent:", defaultConfig.parent);
    console.log("[method-configs] Card display_preference:", JSON.stringify((defaultConfig as any).card?.display_preference, null, 2));

    const methods = Object.entries(defaultConfig)
      .filter(([key]) => !METADATA_FIELDS.has(key))
      .filter(([, value]) => value && typeof value === 'object' && 'display_preference' in value)
      .filter(([id]) => has(PAYMENT_METHOD_DISPLAY_NAMES, id))
      .map(([id, config]) => ({
        id,
        name: PAYMENT_METHOD_DISPLAY_NAMES[id],
        // Use 'value' (what Stripe actually shows at checkout), not 'preference' (what user requested)
        // When overridable is true, updating 'preference' will change 'value'
        // When overridable is false, 'preference' is stored but 'value' stays as platform default
        enabled: (config as any).display_preference?.value === 'on',
        available: (config as any).available || false,
        // When overridable is true, toggles actually work. When false, they're ignored by Stripe.
        overridable: (config as any).display_preference?.overridable ?? false,
      }))
      .sort((a, b) => {
        if (a.available !== b.available) return b.available ? 1 : -1;
        return stringCompare(a.name, b.name);
      });

    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        config_id: defaultConfig.id,
        methods,
      },
    };
  },
});

export const PATCH = createSmartRouteHandler({
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
      config_id: yupString().defined(),
      updates: yupRecord(
        yupString().oneOf(Object.keys(PAYMENT_METHOD_DISPLAY_NAMES)).defined(),
        yupString().oneOf(['on', 'off']).defined()
      ).defined(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      success: yupBoolean().defined(),
    }).defined(),
  }),
  handler: async ({ auth, body }) => {
    const project = await globalPrismaClient.project.findUnique({
      where: { id: auth.project.id },
      select: { stripeAccountId: true },
    });

    if (!project?.stripeAccountId) {
      throw new KnownErrors.StripeAccountInfoNotFound();
    }

    const stripeUpdates: Record<string, { display_preference: { preference: 'on' | 'off' } }> = {};

    for (const [methodId, preference] of Object.entries(body.updates)) {
      stripeUpdates[methodId] = {
        display_preference: { preference: preference as 'on' | 'off' },
      };
    }

    console.log("[method-configs] Updating config:", body.config_id);
    console.log("[method-configs] Stripe account:", project.stripeAccountId);
    console.log("[method-configs] Updates:", JSON.stringify(stripeUpdates, null, 2));

    const stripe = getStackStripe();
    const result = await stripe.paymentMethodConfigurations.update(
      body.config_id,
      stripeUpdates,
      { stripeAccount: project.stripeAccountId }
    );

    console.log("[method-configs] Stripe response:", JSON.stringify(result, null, 2));

    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        success: true,
      },
    };
  },
});
