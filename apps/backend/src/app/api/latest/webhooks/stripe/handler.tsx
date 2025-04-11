import { ProjectsCrud } from "@stackframe/stack-shared/dist/interface/crud/projects";
import Stripe from "stripe";

type StripeConnectEventHandler<T extends Stripe.Event.Type> = (
  stripe: Stripe,
  event: Extract<Stripe.Event, { type: T }>,
  project: ProjectsCrud["Admin"]["Read"]
) => Promise<void>;

export const STRIPE_CONNECT_EVENT_HANDLERS: {
  [T in Stripe.Event.Type]?: StripeConnectEventHandler<T>
} = {
  "customer.subscription.created": async (stripe, event) => {
  },
};
