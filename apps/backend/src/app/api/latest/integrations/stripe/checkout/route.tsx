import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { KnownErrors } from "@stackframe/stack-shared";
import { ProjectsCrud } from "@stackframe/stack-shared/dist/interface/crud/projects";
import { adaptSchema, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import Stripe from "stripe";


function getStripeClient(
  project: ProjectsCrud["Admin"]["Read"],
) {
  if (!project.config.stripe_config) {
    throw new KnownErrors.StripeConfigurationNotFound();
  }
  return new Stripe(project.config.stripe_config.stripe_secret_key);
}

export const POST = createSmartRouteHandler({
  metadata: {
    summary: "Create a checkout session for a customer",
    description: "Create a checkout session for a customer",
    tags: ["Stripe Integration"],
  },
  request: yupObject({
    auth: yupObject({
      project: adaptSchema.defined(),
      user: adaptSchema.defined(),
    }).defined(),
    body: yupObject({
      price_id: yupString().defined(),
      success_url: yupString().defined(),
      cancel_url: yupString().defined(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200, 201]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      status: yupString().oneOf(["success", "error"]).defined(),
      payment_url: yupString().defined(),
    }).defined(),
  }),
  async handler({ body, auth: { project, user } }) {
    const stripe = getStripeClient(project);


    const session = await stripe.checkout.sessions.create({
      customer_email: user.primary_email ?? undefined,
      line_items: [{ price: body.price_id, quantity: 1 }],
      metadata: {
        stack_project_id: project.id,
        stack_user_id: user.id,
      },
      mode: 'payment',
      success_url: body.success_url,
      cancel_url: body.cancel_url,
    });

    return {
      statusCode: 200,
      bodyType: 'json',
      body: {
        status: 'success',
        payment_url: session.url,
      },
    };
  },
});
