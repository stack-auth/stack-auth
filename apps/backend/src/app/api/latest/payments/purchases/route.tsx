import { getCustomerForUser, GLOBAL_STRIPE } from "@/lib/stripe";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, yupArray, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";


export const POST = createSmartRouteHandler({
  request: yupObject({
    auth: yupObject({
      tenancy: adaptSchema.defined(),
      user: adaptSchema.defined(),
    }),
    body: yupObject({
      line_items: yupArray(yupObject({
        product_id: yupString().defined(),
        quantity: yupNumber().defined(),
      })).defined(),
    }),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      purchase_url: yupString().defined(),
    }),
  }),
  async handler({ auth, body }) {
    const lineItems = await Promise.all(body.line_items.map(async item => {
      const product = await GLOBAL_STRIPE.products.retrieve(item.product_id);
      return {
        price: product.default_price as string,
        quantity: item.quantity,
      };
    }));
    const customer = await getCustomerForUser(auth.tenancy.id, auth.user.id);
    const checkoutSession = await GLOBAL_STRIPE.checkout.sessions.create({
      customer: customer.stripeCustomer.id,
      line_items: lineItems,
    });

    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        purchase_url: checkoutSession.url,
      },
    };
  },
});
