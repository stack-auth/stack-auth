import type { GrowthDeliveryChannel } from "./index";

/**
 * The dashboard channel is a deliberate no-op: "unread in the dashboard" is simply
 * `GrowthBrief.readAt IS NULL`, so a ready brief is already "delivered" the moment the briefs page
 * can query it — there is no push step to perform. The channel still exists (rather than the engine
 * special-casing the dashboard) so every brief gets a GrowthDelivery row per channel through one
 * uniform code path, and so future push channels (email, iMessage, Slack, ...) are purely additive
 * registry entries instead of a second wiring mechanism.
 */
export const growthDashboardDeliveryChannel: GrowthDeliveryChannel = {
  id: "dashboard",
  deliver: async () => {
    // Intentionally empty, see the module comment above.
  },
};
