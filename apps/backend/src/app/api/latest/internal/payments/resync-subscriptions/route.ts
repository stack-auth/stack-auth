import { getStripeForAccount, syncStripeSubscriptions } from "@/lib/stripe";
import { globalPrismaClient } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { KnownErrors } from "@stackframe/stack-shared";
import { adaptSchema, adminAuthTypeSchema, yupArray, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";

function ensureInternalProject(projectId: string) {
  if (projectId !== "internal") {
    throw new KnownErrors.ExpectedInternalProject();
  }
}

export const POST = createSmartRouteHandler({
  metadata: {
    summary: "Resync subscriptions from Stripe",
    description: "Resyncs all subscription data from Stripe for one or all projects.",
    tags: ["Payments"],
    hidden: true,
  },
  request: yupObject({
    auth: yupObject({
      type: adminAuthTypeSchema,
      tenancy: adaptSchema,
    }).defined(),
    body: yupObject({
      project_id: yupString().optional(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      synced_projects: yupNumber().defined(),
      total_projects: yupNumber().defined(),
      errors: yupArray(yupString().defined()).defined(),
    }).defined(),
  }),
  handler: async ({ auth, body }) => {
    ensureInternalProject(auth.tenancy.project.id);

    const projectFilter = body.project_id
      ? { id: body.project_id, stripeAccountId: { not: null } }
      : { stripeAccountId: { not: null } };

    const projects = await globalPrismaClient.project.findMany({
      where: projectFilter as any,
      select: { id: true, stripeAccountId: true },
    });

    let syncedProjects = 0;
    const errors: string[] = [];

    for (const project of projects) {
      const stripeAccountId = project.stripeAccountId;
      if (!stripeAccountId) continue;

      try {
        const stripe = await getStripeForAccount({ accountId: stripeAccountId });
        let hasMore = true;
        let startingAfter: string | undefined = undefined;

        while (hasMore) {
          const customers: { data: Array<{ id: string }>, has_more: boolean } = await stripe.customers.list({
            limit: 100,
            ...(startingAfter ? { starting_after: startingAfter } : {}),
          });

          for (const customer of customers.data) {
            try {
              await syncStripeSubscriptions(stripe, stripeAccountId, customer.id);
            } catch (e: any) {
              errors.push(`project=${project.id} customer=${customer.id}: ${e.message ?? String(e)}`);
            }
          }

          hasMore = customers.has_more;
          if (customers.data.length > 0) {
            startingAfter = customers.data[customers.data.length - 1].id;
          }
        }

        syncedProjects++;
      } catch (e: any) {
        errors.push(`project=${project.id}: ${e.message ?? String(e)}`);
      }
    }

    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        synced_projects: syncedProjects,
        total_projects: projects.length,
        errors,
      },
    };
  },
});
