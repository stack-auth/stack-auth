import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { getOrUndefined } from "@stackframe/stack-shared/dist/utils/objects";
import { bulldozerWriteSubscription } from "@/lib/payments/bulldozer-dual-write";
import { getSubscriptionMapForCustomer } from "@/lib/payments/customer-data";
// eslint-disable-next-line @typescript-eslint/no-deprecated -- idiomatic way to get the internal tenancy today (see plan-entitlements.ts)
import { DEFAULT_BRANCH_ID, getSoleTenancyFromProjectBranch } from "@/lib/tenancies";
import { getPrismaClientForTenancy } from "@/prisma-client";
import { ensureFreePlanForBillingTeam } from "./ensure-free-plan";

// Uses the real internal tenancy (relies on its seeded free/team/growth/
// extra-seats product config) and random UUIDs as billing team IDs.
// Subscription rows aren't FK-checked against the Team table, so inserting
// a sub for a non-existent team works and keeps tests side-effect-free on
// real teams.
describe.sequential("ensureFreePlanForBillingTeam (real DB)", () => {
  async function getInternal() {
    const tenancy = await getSoleTenancyFromProjectBranch("internal", DEFAULT_BRANCH_ID, true);
    if (tenancy == null) throw new Error("Internal billing tenancy not found");
    const prisma = await getPrismaClientForTenancy(tenancy);
    return { tenancy, prisma };
  }

  // Returns subs that haven't ended yet — matches the "occupies the product
  // line" semantics of `ensureFreePlanForBillingTeam`'s predicate, which is
  // endedAt-based (not status-based) to mirror the Subscription TimeFold.
  async function getUnendedSubsForTeam(tenancyId: string, billingTeamId: string, prisma: unknown) {
    const subMap = await getSubscriptionMapForCustomer({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mirrors `payments.test.tsx`: PrismaClient is structurally compatible with PrismaClientTransaction here
      prisma: prisma as any,
      tenancyId,
      customerType: "team",
      customerId: billingTeamId,
    });
    const nowMillis = Date.now();
    return Object.values(subMap).filter((s) => s.endedAtMillis == null || s.endedAtMillis > nowMillis);
  }

  async function seedSub(options: {
    tenancyId: string,
    billingTeamId: string,
    productId: string,
    productSnapshot: unknown,
    status?: "active" | "trialing" | "incomplete" | "past_due",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- see `getUnendedSubsForTeam`
    prisma: any,
  }) {
    const now = new Date();
    await bulldozerWriteSubscription(options.prisma, {
      id: randomUUID(),
      tenancyId: options.tenancyId,
      customerId: options.billingTeamId,
      customerType: "TEAM",
      productId: options.productId,
      priceId: null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ProductSnapshot is a structural JSON type; bulldozerWriteSubscription will stamp it into the stored row as-is.
      product: options.productSnapshot as any,
      quantity: 1,
      stripeSubscriptionId: `stripe-${randomUUID()}`,
      status: options.status ?? "active",
      currentPeriodStart: now,
      currentPeriodEnd: new Date(now.getTime() + 30 * 24 * 3600 * 1000),
      cancelAtPeriodEnd: false,
      canceledAt: null,
      endedAt: null,
      refundedAt: null,
      creationSource: "PURCHASE_PAGE",
      createdAt: now,
    });
  }

  it("fast path: no-op when team already owns an active base plan in the line", async () => {
    const { tenancy, prisma } = await getInternal();
    const billingTeamId = randomUUID();

    const teamProduct = getOrUndefined(tenancy.config.payments.products, "team");
    if (teamProduct == null) throw new Error("Internal tenancy missing `team` product");

    await seedSub({
      tenancyId: tenancy.id,
      billingTeamId,
      productId: "team",
      productSnapshot: teamProduct,
      prisma,
    });

    await ensureFreePlanForBillingTeam(billingTeamId);

    const subs = await getUnendedSubsForTeam(tenancy.id, billingTeamId, prisma);
    expect(subs).toHaveLength(1);
    expect(subs[0].productId).toBe("team");
  });

  it("regression: an `incomplete` paid sub still occupies the line — no free regrant", async () => {
    // Reproduces the Stripe webhook race the endedAt-based predicate
    // defends against: `subscription.created` lands first with
    // `status=incomplete` and no `endedAt`; the subsequent `invoice.paid`
    // flips it to `active`. Between those two webhooks, `ensureFree...`
    // must treat the incomplete sub as occupying the line — gating on
    // `status` alone would regrant free on top and leave the customer
    // with both subs active (exactly the chauncey-team dashboard bug).
    const { tenancy, prisma } = await getInternal();
    const billingTeamId = randomUUID();

    const teamProduct = getOrUndefined(tenancy.config.payments.products, "team");
    if (teamProduct == null) throw new Error("Internal tenancy missing `team` product");

    await seedSub({
      tenancyId: tenancy.id,
      billingTeamId,
      productId: "team",
      productSnapshot: teamProduct,
      status: "incomplete",
      prisma,
    });

    await ensureFreePlanForBillingTeam(billingTeamId);

    const subs = await getUnendedSubsForTeam(tenancy.id, billingTeamId, prisma);
    expect(subs).toHaveLength(1);
    expect(subs[0].productId).toBe("team");
  });

  it("slow path: creates a free sub when team has no prior sub in the line", async () => {
    const { tenancy, prisma } = await getInternal();
    const billingTeamId = randomUUID();

    await ensureFreePlanForBillingTeam(billingTeamId);

    const subs = await getUnendedSubsForTeam(tenancy.id, billingTeamId, prisma);
    expect(subs).toHaveLength(1);
    expect(subs[0].productId).toBe("free");
  });

  it("idempotent: sequential double-call creates exactly one free sub", async () => {
    const { tenancy, prisma } = await getInternal();
    const billingTeamId = randomUUID();

    await ensureFreePlanForBillingTeam(billingTeamId);
    await ensureFreePlanForBillingTeam(billingTeamId);

    const subs = await getUnendedSubsForTeam(tenancy.id, billingTeamId, prisma);
    expect(subs).toHaveLength(1);
    expect(subs[0].productId).toBe("free");
  });

  it("slow path race: concurrent Promise.all calls create exactly one free sub", async () => {
    // Exercises the SERIALIZABLE slow path's retry-on-conflict behaviour —
    // both invocations enter the tx concurrently, one commits, the other
    // retries under a fresh snapshot, sees the committed row, and skips.
    const { tenancy, prisma } = await getInternal();
    const billingTeamId = randomUUID();

    await Promise.all([
      ensureFreePlanForBillingTeam(billingTeamId),
      ensureFreePlanForBillingTeam(billingTeamId),
    ]);

    const subs = await getUnendedSubsForTeam(tenancy.id, billingTeamId, prisma);
    expect(subs).toHaveLength(1);
    expect(subs[0].productId).toBe("free");
  });

  it("add-on does not count as a base plan — free is still regranted", async () => {
    const { tenancy, prisma } = await getInternal();
    const billingTeamId = randomUUID();

    // `extra-seats` is an add-on (isAddOnTo: { team, growth }) but lives in
    // the same product line as the free plan. It must NOT short-circuit the
    // fast path; the team should still get a free sub on top.
    const extraSeatsProduct = getOrUndefined(tenancy.config.payments.products, "extra-seats");
    if (extraSeatsProduct == null) throw new Error("Internal tenancy missing `extra-seats` product");

    await seedSub({
      tenancyId: tenancy.id,
      billingTeamId,
      productId: "extra-seats",
      productSnapshot: extraSeatsProduct,
      prisma,
    });

    await ensureFreePlanForBillingTeam(billingTeamId);

    const subs = await getUnendedSubsForTeam(tenancy.id, billingTeamId, prisma);
    const productIds = new Set(subs.map((s) => s.productId));
    expect(subs).toHaveLength(2);
    expect(productIds.has("free")).toBe(true);
    expect(productIds.has("extra-seats")).toBe(true);
  });
});
