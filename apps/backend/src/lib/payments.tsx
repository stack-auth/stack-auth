import { PrismaClientTransaction } from "@/prisma-client";
import { SubscriptionStatus } from "@prisma/client";
import { KnownErrors } from "@stackframe/stack-shared";
import type { inlineOfferSchema, offerSchema } from "@stackframe/stack-shared/dist/schema-fields";
import { FAR_FUTURE_DATE, addInterval, getIntervalsElapsed, getWindowStart } from "@stackframe/stack-shared/dist/utils/dates";
import { StackAssertionError, StatusError } from "@stackframe/stack-shared/dist/utils/errors";
import { getOrUndefined, typedFromEntries } from "@stackframe/stack-shared/dist/utils/objects";
import { typedToUppercase } from "@stackframe/stack-shared/dist/utils/strings";
import { isUuid } from "@stackframe/stack-shared/dist/utils/uuids";
import { Tenancy } from "./tenancies";
import { SUPPORTED_CURRENCIES } from "@stackframe/stack-shared/dist/utils/currencies";
import * as yup from "yup";

export async function ensureOfferIdOrInlineOffer(
  tenancy: Tenancy,
  accessType: "client" | "server" | "admin",
  offerId: string | undefined,
  inlineOffer: yup.InferType<typeof inlineOfferSchema> | undefined
): Promise<Tenancy["config"]["payments"]["offers"][string]> {
  if (offerId && inlineOffer) {
    throw new StatusError(400, "Cannot specify both offer_id and offer_inline!");
  }
  if (inlineOffer && accessType === "client") {
    throw new StatusError(400, "Cannot specify offer_inline when calling from client! Please call with a server API key, or use the offer_id parameter.");
  }
  if (!offerId && !inlineOffer) {
    throw new StatusError(400, "Must specify either offer_id or offer_inline!");
  }
  if (offerId) {
    const offer = getOrUndefined(tenancy.config.payments.offers, offerId);
    if (!offer || (offer.serverOnly && accessType === "client")) {
      throw new KnownErrors.OfferDoesNotExist(offerId, accessType);
    }
    return offer;
  } else {
    if (!inlineOffer) {
      throw new StackAssertionError("Inline offer does not exist, this should never happen", { inlineOffer, offerId });
    }
    return {
      displayName: inlineOffer.display_name,
      customerType: inlineOffer.customer_type,
      freeTrial: inlineOffer.free_trial,
      serverOnly: inlineOffer.server_only,
      stackable: false,
      prices: Object.fromEntries(Object.entries(inlineOffer.prices).map(([key, value]) => [key, {
        ...typedFromEntries(SUPPORTED_CURRENCIES.map(c => [c.code, getOrUndefined(value, c.code)])),
        interval: value.interval,
        freeTrial: value.free_trial,
        serverOnly: true,
      }])),
      includedItems: typedFromEntries(Object.entries(inlineOffer.included_items).map(([key, value]) => [key, {
        repeat: value.repeat ?? "never",
        quantity: value.quantity ?? 0,
        expires: value.expires ?? "never",
      }])),
    };
  }
}

type PositiveLedgerTransaction = {
  amount: number,
  grantTime: Date,
  expirationTime: Date,
};

type NegativeLedgerTransaction = {
  amount: number,
  grantTime: Date,
};

function computeLedgerBalanceAtNow(pos: PositiveLedgerTransaction[], neg: NegativeLedgerTransaction[], now: Date): number {
  const grantedAt = new Map<number, number>();
  const expiredAt = new Map<number, number>();
  const usedAt = new Map<number, number>();
  const timeSet = new Set<number>();

  for (const p of pos) {
    if (p.grantTime <= now) {
      const t = p.grantTime.getTime();
      grantedAt.set(t, (grantedAt.get(t) ?? 0) + p.amount);
      timeSet.add(t);
    }
    if (p.expirationTime <= now) {
      const t2 = p.expirationTime.getTime();
      expiredAt.set(t2, (expiredAt.get(t2) ?? 0) + p.amount);
      timeSet.add(t2);
    }
  }
  for (const n of neg) {
    if (n.grantTime <= now) {
      const t = n.grantTime.getTime();
      usedAt.set(t, (usedAt.get(t) ?? 0) + n.amount);
      timeSet.add(t);
    }
  }

  const times = Array.from(timeSet.values()).sort((a, b) => a - b);
  if (times.length === 0) return 0;

  let grantedSum = 0;
  let expiredSum = 0;
  let usedSum = 0;
  let usedOrExpiredSum = 0;
  for (const t of times) {
    const g = grantedAt.get(t) ?? 0;
    const e = expiredAt.get(t) ?? 0;
    const u = usedAt.get(t) ?? 0;
    grantedSum += g;
    expiredSum += e;
    usedSum += u;
    usedOrExpiredSum = Math.max(usedOrExpiredSum + u, expiredSum);
  }
  return grantedSum - usedOrExpiredSum;
}

export async function getItemQuantityForCustomer(options: {
  prisma: PrismaClientTransaction,
  tenancy: Tenancy,
  itemId: string,
  customerId: string,
  customerType: "user" | "team" | "custom",
}) {
  const now = new Date();
  const itemConfig = getOrUndefined(options.tenancy.config.payments.items, options.itemId);
  const pos: PositiveLedgerTransaction[] = [];
  const neg: NegativeLedgerTransaction[] = [];

  // Manual changes → ledger entries
  const changes = await options.prisma.itemQuantityChange.findMany({
    where: {
      tenancyId: options.tenancy.id,
      customerType: typedToUppercase(options.customerType),
      customerId: options.customerId,
      itemId: options.itemId,
    },
    orderBy: { createdAt: "asc" },
  });
  for (const c of changes) {
    if (c.quantity > 0) {
      pos.push({ amount: c.quantity, grantTime: c.createdAt, expirationTime: c.expiresAt ?? FAR_FUTURE_DATE });
    } else if (c.quantity < 0 && (!c.expiresAt || c.expiresAt > now)) {
      // If a negative change has an expiresAt in the past, it's irrelevant; if in the future or null, treat as active.
      neg.push({ amount: -c.quantity, grantTime: c.createdAt });
    }
  }

  // Defaults → ledger entries
  const def = itemConfig?.default;
  const defQty = def?.quantity ?? 0;
  if (defQty > 0) {
    let anchor: Date;
    if (options.customerType === "user") {
      const user = await options.prisma.projectUser.findUnique({
        where: { tenancyId_projectUserId: { tenancyId: options.tenancy.id, projectUserId: options.customerId } },
        select: { createdAt: true },
      });
      anchor = user?.createdAt ?? now;
    } else if (options.customerType === "team") {
      const team = await options.prisma.team.findUnique({
        where: { tenancyId_teamId: { tenancyId: options.tenancy.id, teamId: options.customerId } },
        select: { createdAt: true },
      });
      anchor = team?.createdAt ?? now;
    } else {
      const firstChange = await options.prisma.itemQuantityChange.findFirst({
        where: {
          tenancyId: options.tenancy.id,
          customerType: typedToUppercase(options.customerType),
          customerId: options.customerId,
          itemId: options.itemId,
        },
        orderBy: { createdAt: "asc" },
        select: { createdAt: true },
      });
      anchor = firstChange?.createdAt ?? now;
    }

    if (!def?.repeat || def.repeat === "never") {
      pos.push({ amount: defQty, grantTime: anchor, expirationTime: FAR_FUTURE_DATE });
    } else {
      const repeat = def.repeat;
      const expires = def.expires;
      if (expires === "when-repeated") {
        const start = getWindowStart(anchor, repeat, now);
        const end = addInterval(new Date(start), repeat);
        pos.push({ amount: defQty, grantTime: start, expirationTime: end });
      } else {
        const elapsed = getIntervalsElapsed(anchor, now, repeat);
        const occurrences = elapsed + 1; // include current window
        const amount = occurrences * defQty;
        pos.push({ amount, grantTime: anchor, expirationTime: FAR_FUTURE_DATE });
      }
    }
  }

  // Subscriptions → ledger entries
  const subscriptions = await options.prisma.subscription.findMany({
    where: {
      tenancyId: options.tenancy.id,
      customerType: typedToUppercase(options.customerType),
      customerId: options.customerId,
      status: { in: [SubscriptionStatus.active, SubscriptionStatus.trialing] },
    },
  });
  for (const s of subscriptions) {
    const offer = s.offer as yup.InferType<typeof offerSchema>;
    const inc = getOrUndefined(offer.includedItems, options.itemId);
    if (!inc) continue;
    const baseQty = inc.quantity * s.quantity;
    if (baseQty <= 0) continue;
    const pStart = s.currentPeriodStart;
    const pEnd = s.currentPeriodEnd;
    const nowClamped = now < pEnd ? now : pEnd;
    if (nowClamped < pStart) continue;

    if (!inc.repeat || inc.repeat === "never") {
      if (inc.expires === "when-purchase-expires") {
        pos.push({ amount: baseQty, grantTime: pStart, expirationTime: pEnd });
      } else if (inc.expires === "when-repeated") {
        pos.push({ amount: baseQty, grantTime: pStart, expirationTime: pEnd < FAR_FUTURE_DATE ? pEnd : FAR_FUTURE_DATE });
      } else {
        pos.push({ amount: baseQty, grantTime: pStart, expirationTime: FAR_FUTURE_DATE });
      }
    } else {
      const repeat = inc.repeat;
      if (inc.expires === "when-purchase-expires") {
        const elapsed = getIntervalsElapsed(pStart, nowClamped, repeat);
        const occurrences = elapsed + 1;
        const amount = occurrences * baseQty;
        pos.push({ amount, grantTime: pStart, expirationTime: pEnd });
      } else if (inc.expires === "when-repeated") {
        const start = getWindowStart(pStart, repeat, nowClamped);
        const end = addInterval(new Date(start), repeat);
        const exp = end < pEnd ? end : pEnd;
        pos.push({ amount: baseQty, grantTime: start, expirationTime: exp });
      } else {
        const elapsed = getIntervalsElapsed(pStart, nowClamped, repeat);
        const occurrences = elapsed + 1;
        const amount = occurrences * baseQty;
        pos.push({ amount, grantTime: pStart, expirationTime: FAR_FUTURE_DATE });
      }
    }
  }

  return computeLedgerBalanceAtNow(pos, neg, now);
}

export async function ensureCustomerExists(options: {
  prisma: PrismaClientTransaction,
  tenancyId: string,
  customerType: "user" | "team" | "custom",
  customerId: string,
}) {
  if (options.customerType === "user") {
    if (!isUuid(options.customerId)) {
      throw new KnownErrors.UserNotFound();
    }
    const user = await options.prisma.projectUser.findUnique({
      where: {
        tenancyId_projectUserId: {
          tenancyId: options.tenancyId,
          projectUserId: options.customerId,
        },
      },
    });
    if (!user) {
      throw new KnownErrors.UserNotFound();
    }
  } else if (options.customerType === "team") {
    if (!isUuid(options.customerId)) {
      throw new KnownErrors.TeamNotFound(options.customerId);
    }
    const team = await options.prisma.team.findUnique({
      where: {
        tenancyId_teamId: {
          tenancyId: options.tenancyId,
          teamId: options.customerId,
        },
      },
    });
    if (!team) {
      throw new KnownErrors.TeamNotFound(options.customerId);
    }
  }
}
