import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";
import { throwErr } from "@hexclave/shared/dist/utils/errors";
import { getOrUndefined } from "@hexclave/shared/dist/utils/objects";
import {
  runRegenInternalSubscriptionsToLatest,
  type StripeClientForRegen,
} from "../../scripts/regen-internal-subscriptions-to-latest";
import { Prisma, PurchaseCreationSource, SubscriptionStatus, CustomerType } from "@/generated/prisma/client";
import { bulldozerWriteSubscription } from "@/lib/payments/bulldozer-dual-write";
import { getItemQuantityForCustomer, getSubscriptionMapForCustomer } from "@/lib/payments/customer-data";
import type { ProductSnapshot } from "@/lib/payments/schema/types";
import { canonicalJsonStringify, computeProductVersionId } from "@/lib/product-versions";
// eslint-disable-next-line @typescript-eslint/no-deprecated -- idiomatic way to get the internal tenancy today
import { DEFAULT_BRANCH_ID, getSoleTenancyFromProjectBranch } from "@/lib/tenancies";
import { getPrismaClientForTenancy, globalPrismaClient } from "@/prisma-client";

type StripeCall =
  | { kind: "retrieve", id: string }
  | { kind: "update", id: string, metadata: Record<string, string | null> };

function makeStripeMock(initial: Record<string, Stripe.Metadata>): {
  client: StripeClientForRegen,
  calls: StripeCall[],
} {
  const calls: StripeCall[] = [];
  const client: StripeClientForRegen = {
    subscriptions: {
      retrieve: async (id: string) => {
        calls.push({ kind: "retrieve", id });
        const metadata = initial[id] ?? {};
        return { metadata };
      },
      update: async (id: string, params: { metadata: Record<string, string | null> }) => {
        calls.push({ kind: "update", id, metadata: params.metadata });
        // Reflect into the "stored" map so subsequent retrieves see the
        // update — useful for idempotency tests.
        const filtered: Record<string, string> = {};
        for (const [k, v] of Object.entries(params.metadata)) {
          if (v != null) filtered[k] = v;
        }
        initial[id] = filtered as Stripe.Metadata;
        return {};
      },
    },
  };
  return { client, calls };
}

describe.sequential("runRegenInternalSubscriptionsToLatest (real DB)", () => {
  async function getInternal() {
    const tenancy = await getSoleTenancyFromProjectBranch("internal", DEFAULT_BRANCH_ID, true);
    if (tenancy == null) throw new Error("Internal billing tenancy not found");
    const prisma = await getPrismaClientForTenancy(tenancy);
    return { tenancy, prisma };
  }

  async function processBulldozerQueue() {
    // Drain Bulldozer's queue so downstream views (item quantities etc.)
    // catch up. Production has pg_cron doing this every second; in
    // tests we trigger it by hand.
    await globalPrismaClient.$executeRaw`SELECT public.bulldozer_timefold_process_queue()`;
  }

  /** Seeds a Subscription in both Prisma and Bulldozer, like a real grant would. */
  async function seedSubscription(args: {
    tenancyId: string,
    teamId: string,
    productId: string,
    productSnapshot: ProductSnapshot,
    stripeSubscriptionId?: string | null,
    creationSource?: PurchaseCreationSource,
    endedAt?: Date | null,
  }): Promise<{ id: string }> {
    const { tenancyId, teamId, productId, productSnapshot } = args;
    const stripeSubId = args.stripeSubscriptionId ?? null;
    const creationSource = args.creationSource ?? PurchaseCreationSource.PURCHASE_PAGE;
    const endedAt = args.endedAt ?? null;
    const now = new Date();
    const sub = await globalPrismaClient.subscription.create({
      data: {
        tenancyId,
        customerId: teamId,
        customerType: CustomerType.TEAM,
        status: SubscriptionStatus.active,
        productId,
        priceId: null,
        product: productSnapshot as unknown as Prisma.InputJsonValue,
        quantity: 1,
        currentPeriodStart: now,
        currentPeriodEnd: new Date(now.getTime() + 30 * 24 * 3600 * 1000),
        cancelAtPeriodEnd: false,
        creationSource,
        stripeSubscriptionId: stripeSubId,
        endedAt,
      },
    });
    await bulldozerWriteSubscription(globalPrismaClient, sub);
    await processBulldozerQueue();
    return { id: sub.id };
  }

  async function getSub(tenancyId: string, id: string) {
    return await globalPrismaClient.subscription.findUniqueOrThrow({
      where: { tenancyId_id: { tenancyId, id } },
    });
  }

  async function getSubMap(tenancyId: string, teamId: string) {
    return await getSubscriptionMapForCustomer({
      prisma: globalPrismaClient,
      tenancyId,
      customerType: "team",
      customerId: teamId,
    });
  }

  /**
   * Drops a specific item from `product.includedItems`. Used by tests
   * that need to control *which* item is removed (e.g. so they can
   * later assert how its quantity recomputes). Most tests should use
   * `makeStale` instead.
   */
  function withoutItem(product: ProductSnapshot, itemId: string): ProductSnapshot {
    const { [itemId]: _omit, ...rest } = product.includedItems;
    return { ...product, includedItems: rest };
  }

  /**
   * Returns a copy of `product` with the first included item dropped.
   * Tests that just need *something* to differ from the latest config
   * call this; they don't care which item is missing.
   *
   * The `?? throwErr` on the empty-keys case is deliberate: without it,
   * `withoutItem(p, undefined)` would silently return `p` unchanged
   * and the next `expect(result.mutated).toBe(1)` would fail for an
   * unrelated-looking reason.
   */
  function makeStale(product: ProductSnapshot): ProductSnapshot {
    const itemId = Object.keys(product.includedItems)[0]
      ?? throwErr(
        "makeStale: product has no includedItems to drop, cannot construct a stale snapshot",
        { product },
      );
    return withoutItem(product, itemId);
  }

  // Spy types differ between vitest minor versions; let TS infer them.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- spy types differ between vitest minor versions; let TS infer them
  let warnSpy: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- see warnSpy above
  let errorSpy: any;
  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(() => {
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("in-product stale sub: rewrites Subscription.product, dual-writes Bulldozer, never calls Stripe", async () => {
    const { tenancy } = await getInternal();
    const teamId = randomUUID();
    const growth = getOrUndefined(tenancy.config.payments.products, "growth");
    if (growth == null) throw new Error("Internal tenancy missing `growth` product");

    // Seed with a stale snapshot (missing one item) and no Stripe link.
    const stale = makeStale(growth);
    const { id } = await seedSubscription({
      tenancyId: tenancy.id,
      teamId,
      productId: "growth",
      productSnapshot: stale,
      stripeSubscriptionId: null,
      creationSource: PurchaseCreationSource.API_GRANT,
    });

    const stripe = makeStripeMock({});
    const result = await runRegenInternalSubscriptionsToLatest({
      teamIdsFilter: [teamId],
      stripeClient: stripe.client,
    });

    expect(result.mutated).toBe(1);
    expect(result.dbWrites).toBe(1);
    expect(result.stripeMetadataWrites).toBe(0);
    expect(result.alreadyCurrent).toBe(0);
    expect(result.skippedFailures).toBe(0);
    // No Stripe interaction at all for in-product subs.
    expect(stripe.calls).toHaveLength(0);

    const updated = await getSub(tenancy.id, id);
    expect(canonicalJsonStringify(updated.product)).toBe(canonicalJsonStringify(growth));

    const subMap = await getSubMap(tenancy.id, teamId);
    expect(canonicalJsonStringify(subMap[id].product)).toBe(canonicalJsonStringify(growth));
  });

  it("in-product fresh sub: no DB write, no Bulldozer write, no Stripe call", async () => {
    const { tenancy } = await getInternal();
    const teamId = randomUUID();
    const growth = getOrUndefined(tenancy.config.payments.products, "growth");
    if (growth == null) throw new Error("Internal tenancy missing `growth` product");

    const { id } = await seedSubscription({
      tenancyId: tenancy.id,
      teamId,
      productId: "growth",
      productSnapshot: growth,
      stripeSubscriptionId: null,
      creationSource: PurchaseCreationSource.API_GRANT,
    });
    const before = await getSub(tenancy.id, id);

    const stripe = makeStripeMock({});
    const result = await runRegenInternalSubscriptionsToLatest({
      teamIdsFilter: [teamId],
      stripeClient: stripe.client,
    });

    expect(result.mutated).toBe(0);
    expect(result.dbWrites).toBe(0);
    expect(result.stripeMetadataWrites).toBe(0);
    expect(result.alreadyCurrent).toBe(1);
    expect(stripe.calls).toHaveLength(0);

    const after = await getSub(tenancy.id, id);
    expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());
  });

  it("Stripe-backed stale sub: updates Stripe metadata FIRST, then DB + bulldozer; ordering is enforced", async () => {
    const { tenancy } = await getInternal();
    const teamId = randomUUID();
    const growth = getOrUndefined(tenancy.config.payments.products, "growth");
    if (growth == null) throw new Error("Internal tenancy missing `growth` product");
    const stale = makeStale(growth);

    const stripeSubId = `stripe-${randomUUID()}`;
    const oldVersionId = computeProductVersionId("growth", stale);
    const { id } = await seedSubscription({
      tenancyId: tenancy.id,
      teamId,
      productId: "growth",
      productSnapshot: stale,
      stripeSubscriptionId: stripeSubId,
      creationSource: PurchaseCreationSource.PURCHASE_PAGE,
    });
    const newVersionId = computeProductVersionId("growth", growth);
    expect(newVersionId).not.toBe(oldVersionId);

    const stripe = makeStripeMock({ [stripeSubId]: { productVersionId: oldVersionId, priceId: "abc" } });
    const result = await runRegenInternalSubscriptionsToLatest({
      teamIdsFilter: [teamId],
      stripeClient: stripe.client,
    });

    expect(result.mutated).toBe(1);
    expect(result.dbWrites).toBe(1);
    expect(result.stripeMetadataWrites).toBe(1);
    expect(result.alreadyCurrent).toBe(0);
    expect(result.skippedFailures).toBe(0);

    // Should have made exactly one retrieve + one update.
    const retrieves = stripe.calls.filter((c) => c.kind === "retrieve");
    const updates = stripe.calls.filter((c) => c.kind === "update");
    expect(retrieves).toHaveLength(1);
    expect(updates).toHaveLength(1);
    expect(retrieves[0].id).toBe(stripeSubId);
    expect(updates[0]).toMatchObject({
      kind: "update",
      id: stripeSubId,
      metadata: { productVersionId: newVersionId, priceId: "abc" },
    });

    const updated = await getSub(tenancy.id, id);
    expect(canonicalJsonStringify(updated.product)).toBe(canonicalJsonStringify(growth));
  });

  it("Stripe-backed fresh sub: no Stripe update, no DB write, no Bulldozer write", async () => {
    const { tenancy } = await getInternal();
    const teamId = randomUUID();
    const growth = getOrUndefined(tenancy.config.payments.products, "growth");
    if (growth == null) throw new Error("Internal tenancy missing `growth` product");

    const stripeSubId = `stripe-${randomUUID()}`;
    const currentVersionId = computeProductVersionId("growth", growth);
    const { id } = await seedSubscription({
      tenancyId: tenancy.id,
      teamId,
      productId: "growth",
      productSnapshot: growth,
      stripeSubscriptionId: stripeSubId,
      creationSource: PurchaseCreationSource.PURCHASE_PAGE,
    });

    const stripe = makeStripeMock({ [stripeSubId]: { productVersionId: currentVersionId } });
    const before = await getSub(tenancy.id, id);

    const result = await runRegenInternalSubscriptionsToLatest({
      teamIdsFilter: [teamId],
      stripeClient: stripe.client,
    });

    expect(result.mutated).toBe(0);
    expect(result.dbWrites).toBe(0);
    expect(result.stripeMetadataWrites).toBe(0);
    expect(result.alreadyCurrent).toBe(1);
    // We DO retrieve to check current metadata, but never call update.
    expect(stripe.calls.filter((c) => c.kind === "update")).toHaveLength(0);

    const after = await getSub(tenancy.id, id);
    expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());
  });

  it("TEST_MODE sub with a non-null stripeSubscriptionId is treated as pure-DB: snapshot rewritten, Stripe never called", async () => {
    // Regression: TEST_MODE subs are simulated entirely in the DB, but
    // some old/dummy data has a Stripe id set. We must never call live
    // Stripe for them, but we still want their snapshot upgraded.
    const { tenancy } = await getInternal();
    const teamId = randomUUID();
    const growth = getOrUndefined(tenancy.config.payments.products, "growth");
    if (growth == null) throw new Error("Internal tenancy missing `growth` product");
    const stale = makeStale(growth);

    const fakeStripeSubId = `stripe-${randomUUID()}`;
    const { id } = await seedSubscription({
      tenancyId: tenancy.id,
      teamId,
      productId: "growth",
      productSnapshot: stale,
      stripeSubscriptionId: fakeStripeSubId,
      creationSource: PurchaseCreationSource.TEST_MODE,
    });

    const stripe = makeStripeMock({});
    const result = await runRegenInternalSubscriptionsToLatest({
      teamIdsFilter: [teamId],
      stripeClient: stripe.client,
    });

    expect(result.mutated).toBe(1);
    expect(result.dbWrites).toBe(1);
    expect(result.stripeMetadataWrites).toBe(0);
    expect(result.alreadyCurrent).toBe(0);
    expect(result.skippedFailures).toBe(0);
    expect(stripe.calls).toHaveLength(0);

    const updated = await getSub(tenancy.id, id);
    expect(canonicalJsonStringify(updated.product)).toBe(canonicalJsonStringify(growth));
  });

  it("Stripe failure on one sub doesn't break the loop: a sibling stale sub still gets regenerated", async () => {
    const { tenancy } = await getInternal();
    const failingTeam = randomUUID();
    const healthyTeam = randomUUID();
    const growth = getOrUndefined(tenancy.config.payments.products, "growth");
    if (growth == null) throw new Error("Internal tenancy missing `growth` product");
    const stale = makeStale(growth);

    const failingStripeId = `stripe-${randomUUID()}`;
    const oldVersionId = computeProductVersionId("growth", stale);

    await seedSubscription({
      tenancyId: tenancy.id,
      teamId: failingTeam,
      productId: "growth",
      productSnapshot: stale,
      stripeSubscriptionId: failingStripeId,
      creationSource: PurchaseCreationSource.PURCHASE_PAGE,
    });
    const { id: healthyId } = await seedSubscription({
      tenancyId: tenancy.id,
      teamId: healthyTeam,
      productId: "growth",
      productSnapshot: stale,
      stripeSubscriptionId: null,
      creationSource: PurchaseCreationSource.API_GRANT,
    });

    // Build a Stripe mock whose .update throws specifically for the
    // failing sub.
    const initialMeta: Record<string, Stripe.Metadata> = {
      [failingStripeId]: { productVersionId: oldVersionId },
    };
    const calls: StripeCall[] = [];
    const stripeClient: StripeClientForRegen = {
      subscriptions: {
        retrieve: async (id: string) => {
          calls.push({ kind: "retrieve", id });
          return { metadata: initialMeta[id] ?? {} };
        },
        update: async (id: string, params: { metadata: Record<string, string | null> }) => {
          calls.push({ kind: "update", id, metadata: params.metadata });
          if (id === failingStripeId) {
            throw new Error("Simulated Stripe outage");
          }
          return {};
        },
      },
    };

    const result = await runRegenInternalSubscriptionsToLatest({
      teamIdsFilter: [failingTeam, healthyTeam],
      stripeClient,
    });

    expect(result.skippedFailures).toBe(1);
    // The healthy in-product sub should still have been regenerated even
    // though the Stripe sub failed first.
    expect(result.mutated).toBe(1);
    expect(result.dbWrites).toBe(1);
    expect(result.stripeMetadataWrites).toBe(0);

    const healthy = await getSub(tenancy.id, healthyId);
    expect(canonicalJsonStringify(healthy.product)).toBe(canonicalJsonStringify(growth));

    // Error logged.
    expect(errorSpy).toHaveBeenCalled();
  });

  it("sub with productId no longer in tenancy config: warns and skips, no writes", async () => {
    const { tenancy } = await getInternal();
    const teamId = randomUUID();
    const growth = getOrUndefined(tenancy.config.payments.products, "growth");
    if (growth == null) throw new Error("Internal tenancy missing `growth` product");

    // Seed a sub whose productId is not in config — we still need a real
    // snapshot for the Prisma row, so we use growth's shape.
    const { id } = await seedSubscription({
      tenancyId: tenancy.id,
      teamId,
      productId: "ghost-product-that-does-not-exist",
      productSnapshot: growth,
      stripeSubscriptionId: null,
      creationSource: PurchaseCreationSource.API_GRANT,
    });
    const before = await getSub(tenancy.id, id);

    const stripe = makeStripeMock({});
    const result = await runRegenInternalSubscriptionsToLatest({
      teamIdsFilter: [teamId],
      stripeClient: stripe.client,
    });

    expect(result.skippedMissingProduct).toBe(1);
    expect(result.mutated).toBe(0);
    expect(result.dbWrites).toBe(0);
    expect(warnSpy).toHaveBeenCalled();
    expect(stripe.calls).toHaveLength(0);

    const after = await getSub(tenancy.id, id);
    expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());
  });

  it("ended subs are skipped (filter excludes them)", async () => {
    const { tenancy } = await getInternal();
    const teamId = randomUUID();
    const growth = getOrUndefined(tenancy.config.payments.products, "growth");
    if (growth == null) throw new Error("Internal tenancy missing `growth` product");
    const stale = makeStale(growth);

    const yesterday = new Date(Date.now() - 24 * 3600 * 1000);
    const { id } = await seedSubscription({
      tenancyId: tenancy.id,
      teamId,
      productId: "growth",
      productSnapshot: stale,
      stripeSubscriptionId: null,
      creationSource: PurchaseCreationSource.API_GRANT,
      endedAt: yesterday,
    });
    const before = await getSub(tenancy.id, id);

    const stripe = makeStripeMock({});
    const result = await runRegenInternalSubscriptionsToLatest({
      teamIdsFilter: [teamId],
      stripeClient: stripe.client,
    });

    expect(result.mutated).toBe(0);
    expect(result.skippedEnded).toBe(1);
    expect(stripe.calls).toHaveLength(0);

    const after = await getSub(tenancy.id, id);
    expect(canonicalJsonStringify(after.product)).toBe(canonicalJsonStringify(stale));
    expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());
  });

  it("Bulldozer end-to-end: after regen, getItemQuantityForCustomer for a newly-added item returns the expected non-zero quantity", async () => {
    const { tenancy } = await getInternal();
    const teamId = randomUUID();
    const growth = getOrUndefined(tenancy.config.payments.products, "growth");
    if (growth == null) throw new Error("Internal tenancy missing `growth` product");

    // Pick an existing item (e.g. analytics_events) and forge a "stale"
    // snapshot that's missing it. After the regen, its quantity in
    // payments-item-quantities should reflect what `growth.includedItems`
    // says for that item. This proves the TimeFold → LFold chain
    // recomputed from the fresh snapshot, which is what we depend on.
    const candidateItemId = Object.keys(growth.includedItems).find(
      (k) => {
        const itemConfig = growth.includedItems[k];
        const q = (itemConfig as { quantity?: unknown }).quantity;
        return typeof q === "number" && q > 0;
      },
    );
    if (candidateItemId == null) {
      throw new Error("growth product has no positive-quantity included item to use for this test");
    }
    const stale = withoutItem(growth, candidateItemId);
    const expectedQuantity = (growth.includedItems[candidateItemId] as { quantity: number }).quantity;

    await seedSubscription({
      tenancyId: tenancy.id,
      teamId,
      productId: "growth",
      productSnapshot: stale,
      stripeSubscriptionId: null,
      creationSource: PurchaseCreationSource.API_GRANT,
    });

    // Sanity: the stale sub's quantity for the removed item should be
    // zero (or equal to what the stale snapshot says). We mostly just
    // care that it's NOT what the latest config says.
    await processBulldozerQueue();
    const beforeQty = await getItemQuantityForCustomer({
      prisma: globalPrismaClient,
      tenancyId: tenancy.id,
      itemId: candidateItemId,
      customerId: teamId,
      customerType: "team",
    });
    expect(beforeQty).not.toBe(expectedQuantity);

    const stripe = makeStripeMock({});
    const result = await runRegenInternalSubscriptionsToLatest({
      teamIdsFilter: [teamId],
      stripeClient: stripe.client,
    });
    expect(result.mutated).toBe(1);
    expect(result.dbWrites).toBe(1);

    // Drain the queue so item-quantities catches up.
    await processBulldozerQueue();

    const afterQty = await getItemQuantityForCustomer({
      prisma: globalPrismaClient,
      tenancyId: tenancy.id,
      itemId: candidateItemId,
      customerId: teamId,
      customerType: "team",
    });
    expect(afterQty).toBe(expectedQuantity);
  });
});
