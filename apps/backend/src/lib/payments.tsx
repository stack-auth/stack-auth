import { PrismaClientTransaction } from "@/prisma-client";
import { SubscriptionStatus } from "@prisma/client";
import { KnownErrors } from "@stackframe/stack-shared";
import type { inlineOfferSchema, offerSchema } from "@stackframe/stack-shared/dist/schema-fields";
import { SUPPORTED_CURRENCIES } from "@stackframe/stack-shared/dist/utils/currency-constants";
import { addInterval, FAR_FUTURE_DATE, getIntervalsElapsed, getWindowStart, subtractInterval } from "@stackframe/stack-shared/dist/utils/dates";
import { StackAssertionError, StatusError } from "@stackframe/stack-shared/dist/utils/errors";
import { getOrUndefined, typedEntries, typedFromEntries } from "@stackframe/stack-shared/dist/utils/objects";
import { typedToUppercase } from "@stackframe/stack-shared/dist/utils/strings";
import { isUuid } from "@stackframe/stack-shared/dist/utils/uuids";
import * as yup from "yup";
import { Tenancy } from "./tenancies";

const DEFAULT_OFFER_START_DATE = new Date("2024-01-01T12:00:00.000Z");

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
      groupId: undefined,
      isAddOnTo: false,
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

function addWhenRepeatedBackfillTransactions(options: {
  baseQty: number,
  currentPeriodStart: Date,
  currentPeriodEnd: Date | null,
  subscriptionCreatedAt: Date,
}): PositiveLedgerTransaction[] {
  const { baseQty, currentPeriodStart, currentPeriodEnd, subscriptionCreatedAt } = options;
  const entries: PositiveLedgerTransaction[] = [];
  const end = currentPeriodEnd ?? FAR_FUTURE_DATE;
  entries.push({ amount: baseQty, grantTime: currentPeriodStart, expirationTime: end });
  if (!currentPeriodEnd) {
    return entries;
  }
  const periodLengthMs = end.getTime() - currentPeriodStart.getTime();
  if (periodLengthMs <= 0) {
    return entries;
  }
  let nextEnd = new Date(currentPeriodStart.getTime());
  while (nextEnd > subscriptionCreatedAt) {
    const nextStart = new Date(nextEnd.getTime() - periodLengthMs);
    entries.push({ amount: baseQty, grantTime: nextStart, expirationTime: nextEnd });
    nextEnd = nextStart;
  }
  return entries;
}

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
  if (times.length === 0) {
    return 0;
  }

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

function addWhenRepeatedItemWindowTransactions(options: {
  baseQty: number,
  repeat: [number, 'day' | 'week' | 'month' | 'year'],
  anchor: Date,
  nowClamped: Date,
  hardEnd: Date | null,
}): PositiveLedgerTransaction[] {
  const { baseQty, repeat, anchor, nowClamped } = options;
  const endLimit = options.hardEnd ?? FAR_FUTURE_DATE;
  const finalNow = nowClamped < endLimit ? nowClamped : endLimit;
  if (finalNow < anchor) return [];

  const entries: PositiveLedgerTransaction[] = [];
  let windowStart = getWindowStart(anchor, repeat, finalNow);
  // Backfill windows from current window back to anchor (inclusive)
  while (windowStart >= anchor) {
    const windowEnd = addInterval(new Date(windowStart), repeat);
    const expirationTime = windowEnd < endLimit ? windowEnd : endLimit;
    entries.push({ amount: baseQty, grantTime: windowStart, expirationTime });
    windowStart = subtractInterval(windowStart, repeat);
  }
  return entries;
}

export async function getItemQuantityForCustomer(options: {
  prisma: PrismaClientTransaction,
  tenancy: Tenancy,
  itemId: string,
  customerId: string,
  customerType: "user" | "team" | "custom",
}) {
  const now = new Date();
  const pos: PositiveLedgerTransaction[] = [];
  const neg: NegativeLedgerTransaction[] = [];

  // Quantity changes → ledger entries
  const changes = await options.prisma.itemQuantityChange.findMany({
    where: {
      tenancyId: options.tenancy.id,
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

  // Subscriptions → ledger entries
  const subscriptions = await getSubscriptions({
    prisma: options.prisma,
    tenancy: options.tenancy,
    customerType: options.customerType,
    customerId: options.customerId,
  });
  for (const s of subscriptions) {
    const offer = s.offer as yup.InferType<typeof offerSchema>;
    const inc = getOrUndefined(offer.includedItems, options.itemId);
    if (!inc) continue;
    const baseQty = inc.quantity * s.quantity;
    if (baseQty <= 0) continue;
    const pStart = s.currentPeriodStart;
    const pEnd = s.currentPeriodEnd ?? FAR_FUTURE_DATE;
    const nowClamped = now < pEnd ? now : pEnd;
    if (nowClamped < pStart) continue;

    if (!inc.repeat || inc.repeat === "never") {
      if (inc.expires === "when-purchase-expires") {
        pos.push({ amount: baseQty, grantTime: pStart, expirationTime: pEnd });
      } else if (inc.expires === "when-repeated") {
        // repeat=never + expires=when-repeated → treat as no expiry
        pos.push({ amount: baseQty, grantTime: pStart, expirationTime: FAR_FUTURE_DATE });
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
        const entries = addWhenRepeatedItemWindowTransactions({
          baseQty,
          repeat,
          anchor: s.createdAt,
          nowClamped,
          hardEnd: s.currentPeriodEnd,
        });
        pos.push(...entries);
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

type Subscription = {
  offerId: string,
  offer: yup.InferType<typeof offerSchema>,
  quantity: number,
  currentPeriodStart: Date,
  currentPeriodEnd: Date | null,
  status: SubscriptionStatus,
  createdAt: Date,
};

async function getSubscriptions(options: {
  prisma: PrismaClientTransaction,
  tenancy: Tenancy,
  customerType: "user" | "team" | "custom",
  customerId: string,
}) {
  const groups = options.tenancy.config.payments.groups;
  const offers = options.tenancy.config.payments.offers;
  const subscriptions: Subscription[] = [];
  const dbSubscriptions = await options.prisma.subscription.findMany({
    where: {
      tenancyId: options.tenancy.id,
      customerType: typedToUppercase(options.customerType),
      customerId: options.customerId,
    },
  });

  for (const groupId of Object.keys(groups)) {
    const offersInGroup = typedEntries(offers).filter(([_, offer]) => offer.groupId === groupId);
    for (const [offerId, offer] of offersInGroup) {
      const subscription = dbSubscriptions.find(s => s.offerId === offerId);
      if (subscription) {
        subscriptions.push({
          offerId,
          offer,
          quantity: subscription.quantity,
          currentPeriodStart: subscription.currentPeriodStart,
          currentPeriodEnd: subscription.currentPeriodEnd,
          status: subscription.status,
          createdAt: subscription.createdAt,
        });
        continue;
      }
    }
    const defaultGroupOffer = offersInGroup.find(([_, offer]) => offer.prices === "include-by-default");
    if (defaultGroupOffer) {
      subscriptions.push({
        offerId: defaultGroupOffer[0],
        offer: defaultGroupOffer[1],
        quantity: 1,
        currentPeriodStart: DEFAULT_OFFER_START_DATE,
        currentPeriodEnd: null,
        status: SubscriptionStatus.active,
        createdAt: DEFAULT_OFFER_START_DATE,
      });
    }
  }

  return subscriptions;
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
