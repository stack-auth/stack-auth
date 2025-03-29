import { ProjectsCrud } from "@stackframe/stack-shared/dist/interface/crud/projects";
import { getEnvVariable } from "@stackframe/stack-shared/dist/utils/env";
import Stripe from "stripe";

export function getStripeClient(
  project?: ProjectsCrud["Admin"]["Read"],
) {
  const secretKey =
    project?.config.stripe_config?.stripe_secret_key ??
    getEnvVariable("STACK_STRIPE_SECRET_KEY");
  return new Stripe(secretKey);
}
