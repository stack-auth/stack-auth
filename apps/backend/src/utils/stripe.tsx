import { ProjectsCrud } from "@stackframe/stack-shared/dist/interface/crud/projects";
import { getEnvVariable } from "@stackframe/stack-shared/dist/utils/env";
import Stripe from "stripe";

export function getStripeClient(
  project?: ProjectsCrud["Admin"]["Read"],
) {
  // If project has a Stripe config, use its secret key
  if (project?.config.stripe_config) {
    const config = project.config.stripe_config;
    
    // If using Stripe Connect (account ID is provided)
    if (config.stripe_account_id) {
      // For Stripe Connect integrations, use the platform's secret key
      const platformSecretKey = getEnvVariable("STACK_STRIPE_SECRET_KEY");
      return new Stripe(platformSecretKey);
    }
    
    // If using direct API keys
    if (config.stripe_secret_key) {
      return new Stripe(config.stripe_secret_key);
    }
  }
  
  // Fallback to environment variable
  const secretKey = getEnvVariable("STACK_STRIPE_SECRET_KEY");
  return new Stripe(secretKey);
}
