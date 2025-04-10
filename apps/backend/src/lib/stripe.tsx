import { prismaClient } from "@/prisma-client";
import { Customer } from "@prisma/client";
import { getEnvVariable } from "@stackframe/stack-shared/dist/utils/env";
import Stripe from "stripe";

export const GLOBAL_STRIPE = new Stripe(getEnvVariable("STACK_STRIPE_SECRET_KEY"));

async function getCustomerForUser(tenancyId: string, userId: string): Promise<Customer & { stripeCustomer: Stripe.Customer }> {
  const customer = await prismaClient.customer.findUnique({
    where: {
      tenancyId_projectUserId: {
        tenancyId: tenancyId,
        projectUserId: userId,
      },
    },
  });

  let stripeCustomer: Stripe.Customer;
  if (!customer) {
    stripeCustomer = await GLOBAL_STRIPE.customers.create({});
    await prismaClient.customer.create({
      data: {
        tenancyId: tenancyId,
        projectUserId: userId,
        stripeCustomerId: stripeCustomer.id,
      },
    });
  } else {
    // stripeCustomer = await GLOBAL_STRIPE.customers.retrieve(customer.stripeCustomerId);
  }
}
