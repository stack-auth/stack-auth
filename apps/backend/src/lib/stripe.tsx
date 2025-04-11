import { prismaClient } from "@/prisma-client";
import { Customer } from "@prisma/client";
import { getEnvVariable } from "@stackframe/stack-shared/dist/utils/env";
import Stripe from "stripe";

export const GLOBAL_STRIPE = new Stripe(getEnvVariable("STACK_STRIPE_SECRET_KEY"));

// get the customer for a user; create a new one (as well as a stripe customer) if it doesn't exist
export async function getCustomerForUser(tenancyId: string, userId: string): Promise<Customer & { stripeCustomer: Stripe.Customer }> {
  let customer = await prismaClient.customer.findUnique({
    where: {
      tenancyId_projectUserId: {
        tenancyId,
        projectUserId: userId
      }
    }
  });

  if (!customer || !customer.stripeCustomerId) {
    const stripeCustomer = await GLOBAL_STRIPE.customers.create({
      metadata: {
        tenancyId,
        projectUserId: userId
      }
    });

    if (!customer) {
      customer = await prismaClient.customer.create({
        data: {
          tenancyId,
          projectUserId: userId,
          stripeCustomerId: stripeCustomer.id
        }
      });
    } else {
      customer = await prismaClient.customer.update({
        where: {
          tenancyId_projectUserId: {
            tenancyId,
            projectUserId: userId
          }
        },
        data: {
          stripeCustomerId: stripeCustomer.id
        }
      });
    }
  }

  if (!customer.stripeCustomerId) {
    throw new Error("Customer exists but stripeCustomerId is still null after updates");
  }

  const stripeCustomer = await GLOBAL_STRIPE.customers.retrieve(customer.stripeCustomerId);

  if (stripeCustomer.deleted) {
    throw new Error(`Stripe customer ${customer.stripeCustomerId} was deleted`);
  }

  return {
    ...customer,
    stripeCustomer
  };
}
