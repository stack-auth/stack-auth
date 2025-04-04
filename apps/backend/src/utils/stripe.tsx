import { ProjectsCrud } from "@stackframe/stack-shared/dist/interface/crud/projects";
import { getEnvVariable } from "@stackframe/stack-shared/dist/utils/env";
import { StackAssertionError } from "@stackframe/stack-shared/dist/utils/errors";
import Stripe from "stripe";

const STACK_STRIPE_SECRET_KEY = getEnvVariable("STACK_STRIPE_SECRET_KEY");

// If project has stripe_account_id set, get the client for Stripe Connect
// If the project has the secret key set, get the client for direct API keys
// Otherwise, get the client for the Stack-wide secret key
export function getStripeClient(
  project?: ProjectsCrud["Admin"]["Read"],
) {
  if (!project) {
    return new Stripe(STACK_STRIPE_SECRET_KEY);
  }

  if (project.config.stripe_config) {
    const config = project.config.stripe_config;

    if (config.stripe_account_id) {
      return new Stripe(STACK_STRIPE_SECRET_KEY, {
        stripeAccount: config.stripe_account_id,
      });
    }

    if (config.stripe_secret_key) {
      return new Stripe(config.stripe_secret_key);
    }
  }
  throw new StackAssertionError("Project has no Stripe config");
}
