import { getCustomerForUser, GLOBAL_STRIPE } from "@/lib/stripe";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, userIdOrMeSchema, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";


export const POST = createSmartRouteHandler({
  request: yupObject({
    auth: yupObject({
      tenancy: adaptSchema.defined(),
      user: adaptSchema.defined(),
    }),
    params: yupObject({
      user_id: userIdOrMeSchema.defined(),
    }),
    body: yupObject({
      product_id: yupString().defined(),
      quantity: yupNumber().defined(),
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
    const stripeProduct = await GLOBAL_STRIPE.products.retrieve(body.product_id);
    const customer = await getCustomerForUser(auth.tenancy.id, auth.user.id);
    const checkoutSession = await GLOBAL_STRIPE.checkout.sessions.create({
      customer: customer.stripeCustomer.id,
      line_items: [{
        price: stripeProduct.default_price as string,
        quantity: 1,
      }],
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
