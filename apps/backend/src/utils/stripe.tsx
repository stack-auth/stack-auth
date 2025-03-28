import { KnownErrors } from "@stackframe/stack-shared";
import { ProjectsCrud } from "@stackframe/stack-shared/dist/interface/crud/projects";
import Stripe from "stripe";

export function getStripeClient(
  project: ProjectsCrud["Admin"]["Read"],
) {
  if (!project.config.stripe_config) {
    throw new KnownErrors.StripeConfigurationNotFound();
  }
  return new Stripe(project.config.stripe_config.stripe_secret_key);
}
