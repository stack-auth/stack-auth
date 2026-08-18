import type { GrowthBrief } from "@/generated/prisma/client";
import type { Tenancy } from "@/lib/tenancies";
import { growthDashboardDeliveryChannel } from "./dashboard";

/**
 * The brief delivery-channel registry. The engine's wireBriefDeliveries sub-step walks this registry
 * for every "ready" brief and creates one GrowthDelivery row per (brief, channel), so adding a new
 * way to deliver briefs (email, iMessage, Slack, ...) is purely additive: implement the channel in a
 * sibling file and register it here. Per-project channel selection (a future `briefChannels` config
 * field) will filter this registry at wiring time; until that field exists, every registered channel
 * applies to every project.
 */
export type GrowthDeliveryChannel = {
  /** Stored verbatim in GrowthDelivery.channel (unique per brief), so ids must never be reused. */
  id: string,
  deliver(options: { brief: GrowthBrief, tenancy: Tenancy }): Promise<void>,
};

// A Map (not a record) with insertion-ordered iteration: the engine walks the registry in a loop,
// and deterministic order keeps delivery-row creation (and therefore tick behavior) reproducible.
export const GROWTH_DELIVERY_CHANNELS: Map<string, GrowthDeliveryChannel> = new Map(
  [growthDashboardDeliveryChannel].map((channel) => [channel.id, channel]),
);

/**
 * Which registered channels a brief still needs a GrowthDelivery row for. Pure so the engine's
 * wiring decision is unit-testable without a database; rows in ANY status (including "failed")
 * count as handled — a failed delivery is terminal for that (brief, channel), never retried.
 */
export function selectMissingGrowthDeliveryChannelIds(existingChannelIds: readonly string[]): string[] {
  const existing = new Set(existingChannelIds);
  return [...GROWTH_DELIVERY_CHANNELS.keys()].filter((channelId) => !existing.has(channelId));
}
