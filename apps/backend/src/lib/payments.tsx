import { PrismaClientTransaction } from "@/prisma-client";
import { SubscriptionStatus } from "@prisma/client";
import { KnownErrors } from "@stackframe/stack-shared";
import type { inlineOfferSchema, offerSchema } from "@stackframe/stack-shared/dist/schema-fields";
import { SUPPORTED_CURRENCIES } from "@stackframe/stack-shared/dist/utils/currency-constants";
import { addInterval, FAR_FUTURE_DATE, getIntervalsElapsed } from "@stackframe/stack-shared/dist/utils/dates";
import { StackAssertionError, StatusError, throwErr } from "@stackframe/stack-shared/dist/utils/errors";
import { getOrUndefined, typedEntries, typedFromEntries, typedKeys } from "@stackframe/stack-shared/dist/utils/objects";
import { typedToUppercase } from "@stackframe/stack-shared/dist/utils/strings";
import { isUuid } from "@stackframe/stack-shared/dist/utils/uuids";
import Stripe from "stripe";
import * as yup from "yup";
import { Tenancy } from "./tenancies";

const DEFAULT_OFFER_START_DATE = new Date("1973-01-01T12:00:00.000Z"); // monday

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

type LedgerTransaction = {
  amount: number,
  grantTime: Date,
  expirationTime: Date,
};


function computeLedgerBalanceAtNow(transactions: LedgerTransaction[], now: Date): number {
  const grantedAt = new Map<number, number>();
  const expiredAt = new Map<number, number>();
  const usedAt = new Map<number, number>();
  const timeSet = new Set<number>();

  for (const t of transactions) {
    const grantTime = t.grantTime.getTime();
    if (t.grantTime <= now && t.amount < 0 && t.expirationTime > now) {
      usedAt.set(grantTime, (-1 * t.amount) + (usedAt.get(grantTime) ?? 0));
    }
    if (t.grantTime <= now && t.amount > 0) {
      grantedAt.set(grantTime, (grantedAt.get(grantTime) ?? 0) + t.amount);
    }
    if (t.expirationTime <= now && t.amount > 0) {
      const time2 = t.expirationTime.getTime();
      expiredAt.set(time2, (expiredAt.get(time2) ?? 0) + t.amount);
      timeSet.add(time2);
    }
    timeSet.add(grantTime);
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
}): LedgerTransaction[] {
  const { baseQty, repeat, anchor, nowClamped } = options;
  const endLimit = options.hardEnd ?? FAR_FUTURE_DATE;
  const finalNow = nowClamped < endLimit ? nowClamped : endLimit;
  if (finalNow < anchor) return [];

  const entries: LedgerTransaction[] = [];
  const elapsed = getIntervalsElapsed(anchor, finalNow, repeat);

  for (let i = 0; i <= elapsed; i++) {
    const windowStart = addInterval(new Date(anchor), [repeat[0] * i, repeat[1]]);
    const windowEnd = addInterval(new Date(windowStart), repeat);
    entries.push({ amount: baseQty, grantTime: windowStart, expirationTime: windowEnd });
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
  const transactions: LedgerTransaction[] = [];

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
    transactions.push({
      amount: c.quantity,
      grantTime: c.createdAt,
      expirationTime: c.expiresAt ?? FAR_FUTURE_DATE,
    });
  }
  const oneTimePurchases = await options.prisma.oneTimePurchase.findMany({
    where: {
      tenancyId: options.tenancy.id,
      customerId: options.customerId,
      customerType: typedToUppercase(options.customerType),
    },
  });
  for (const p of oneTimePurchases) {
    const offer = p.offer as yup.InferType<typeof offerSchema>;
    const inc = getOrUndefined(offer.includedItems, options.itemId);
    if (!inc) continue;
    const baseQty = inc.quantity * p.quantity;
    if (baseQty <= 0) continue;
    transactions.push({
      amount: baseQty,
      grantTime: p.createdAt,
      expirationTime: FAR_FUTURE_DATE,
    });
  }

  // Subscriptions → ledger entries
  const subscriptions = await getSubscriptions({
    prisma: options.prisma,
    tenancy: options.tenancy,
    customerType: options.customerType,
    customerId: options.customerId,
  });
  for (const s of subscriptions) {
    const offer = s.offer;
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
        transactions.push({ amount: baseQty, grantTime: pStart, expirationTime: pEnd });
      } else if (inc.expires === "when-repeated") {
        // repeat=never + expires=when-repeated → treat as no expiry
        transactions.push({ amount: baseQty, grantTime: pStart, expirationTime: FAR_FUTURE_DATE });
      } else {
        transactions.push({ amount: baseQty, grantTime: pStart, expirationTime: FAR_FUTURE_DATE });
      }
    } else {
      const repeat = inc.repeat;
      if (inc.expires === "when-purchase-expires") {
        const elapsed = getIntervalsElapsed(pStart, nowClamped, repeat);
        const occurrences = elapsed + 1;
        const amount = occurrences * baseQty;
        transactions.push({ amount, grantTime: pStart, expirationTime: pEnd });
      } else if (inc.expires === "when-repeated") {
        const entries = addWhenRepeatedItemWindowTransactions({
          baseQty,
          repeat,
          anchor: s.createdAt,
          nowClamped,
          hardEnd: s.currentPeriodEnd,
        });
        transactions.push(...entries);
      } else {
        const elapsed = getIntervalsElapsed(pStart, nowClamped, repeat);
        const occurrences = elapsed + 1;
        const amount = occurrences * baseQty;
        transactions.push({ amount, grantTime: pStart, expirationTime: FAR_FUTURE_DATE });
      }
    }
  }

  return computeLedgerBalanceAtNow(transactions, now);
}

type Subscription = {
  /**
   * `null` for default subscriptions
   */
  id: string | null,
  /**
   * `null` for inline offers
   */
  offerId: string | null,
  /**
   * `null` for test mode purchases and group default offers
   */
  stripeSubscriptionId: string | null,
  offer: yup.InferType<typeof offerSchema>,
  quantity: number,
  currentPeriodStart: Date,
  currentPeriodEnd: Date | null,
  status: SubscriptionStatus,
  createdAt: Date,
};

export function isActiveSubscription(subscription: Subscription): boolean {
  return subscription.status === SubscriptionStatus.active || subscription.status === SubscriptionStatus.trialing;
}

export async function getSubscriptions(options: {
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

  const groupsWithDbSubscriptions = new Set<string>();
  for (const s of dbSubscriptions) {
    const offer = s.offerId ? getOrUndefined(offers, s.offerId) : s.offer as yup.InferType<typeof offerSchema>;
    if (!offer) continue;
    subscriptions.push({
      id: s.id,
      offerId: s.offerId,
      offer,
      quantity: s.quantity,
      currentPeriodStart: s.currentPeriodStart,
      currentPeriodEnd: s.currentPeriodEnd,
      status: s.status,
      createdAt: s.createdAt,
      stripeSubscriptionId: s.stripeSubscriptionId,
    });
    if (offer.groupId !== undefined) {
      groupsWithDbSubscriptions.add(offer.groupId);
    }
  }

  for (const groupId of Object.keys(groups)) {
    if (groupsWithDbSubscriptions.has(groupId)) continue;
    const offersInGroup = typedEntries(offers).filter(([_, offer]) => offer.groupId === groupId);
    const defaultGroupOffer = offersInGroup.find(([_, offer]) => offer.prices === "include-by-default");
    if (defaultGroupOffer) {
      subscriptions.push({
        id: null,
        offerId: defaultGroupOffer[0],
        offer: defaultGroupOffer[1],
        quantity: 1,
        currentPeriodStart: DEFAULT_OFFER_START_DATE,
        currentPeriodEnd: null,
        status: SubscriptionStatus.active,
        createdAt: DEFAULT_OFFER_START_DATE,
        stripeSubscriptionId: null,
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

type Offer = yup.InferType<typeof offerSchema>;
type SelectedPrice = Exclude<Offer["prices"], "include-by-default">[string];

export async function validatePurchaseSession(options: {
  prisma: PrismaClientTransaction,
  tenancy: Tenancy,
  codeData: {
    tenancyId: string,
    customerId: string,
    offerId?: string,
    offer: Offer,
  },
  priceId: string,
  quantity: number,
}): Promise<{
  selectedPrice: SelectedPrice | undefined,
  groupId: string | undefined,
  subscriptions: Subscription[],
  conflictingGroupSubscriptions: Subscription[],
}> {
  const { prisma, tenancy, codeData, priceId, quantity } = options;
  const offer = codeData.offer;
  await ensureCustomerExists({
    prisma,
    tenancyId: tenancy.id,
    customerType: offer.customerType,
    customerId: codeData.customerId,
  });

  let selectedPrice: SelectedPrice | undefined = undefined;
  if (offer.prices !== "include-by-default") {
    const pricesMap = new Map(typedEntries(offer.prices));
    selectedPrice = pricesMap.get(priceId);
    if (!selectedPrice) {
      throw new StatusError(400, "Price not found on offer associated with this purchase code");
    }
  }
  if (quantity !== 1 && offer.stackable !== true) {
    throw new StatusError(400, "This offer is not stackable; quantity must be 1");
  }

  // Block based on prior one-time purchases for same customer and customerType
  const existingOneTimePurchases = await prisma.oneTimePurchase.findMany({
    where: {
      tenancyId: tenancy.id,
      customerId: codeData.customerId,
      customerType: typedToUppercase(offer.customerType),
    },
  });

  if (codeData.offerId && existingOneTimePurchases.some((p) => p.offerId === codeData.offerId)) {
    throw new StatusError(400, "Customer already has a one-time purchase for this offer");
  }

  const subscriptions = await getSubscriptions({
    prisma,
    tenancy,
    customerType: offer.customerType,
    customerId: codeData.customerId,
  });
  if (subscriptions.find((s) => s.offerId === codeData.offerId) && offer.stackable !== true) {
    throw new StatusError(400, "Customer already has a subscription for this offer; this offer is not stackable");
  }
  const addOnOfferIds = offer.isAddOnTo ? typedKeys(offer.isAddOnTo) : [];
  if (offer.isAddOnTo && !subscriptions.some((s) => s.offerId && addOnOfferIds.includes(s.offerId))) {
    throw new StatusError(400, "This offer is an add-on to an offer that the customer does not have");
  }

  const groups = tenancy.config.payments.groups;
  const groupId = typedKeys(groups).find((g) => offer.groupId === g);

  // Block purchasing any offer in the same group if a one-time purchase exists in that group
  if (groupId) {
    const hasOneTimeInGroup = existingOneTimePurchases.some((p) => {
      const offer = p.offer as yup.InferType<typeof offerSchema>;
      return offer.groupId === groupId;
    });
    if (hasOneTimeInGroup) {
      throw new StatusError(400, "Customer already has a one-time purchase in this offer group");
    }
  }

  let conflictingGroupSubscriptions: Subscription[] = [];
  if (groupId) {
    conflictingGroupSubscriptions = subscriptions.filter((subscription) => (
      subscription.id &&
      subscription.offerId &&
      subscription.offer.groupId === groupId &&
      isActiveSubscription(subscription) &&
      subscription.offer.prices !== "include-by-default" &&
      (!offer.isAddOnTo || !addOnOfferIds.includes(subscription.offerId))
    ));
  }

  return { selectedPrice, groupId, subscriptions, conflictingGroupSubscriptions };
}

export function getClientSecretFromStripeSubscription(subscription: Stripe.Subscription): string {
  const latestInvoice = subscription.latest_invoice;
  if (latestInvoice && typeof latestInvoice !== "string") {
    type InvoiceWithExtras = Stripe.Invoice & {
      confirmation_secret?: { client_secret?: string },
      payment_intent?: string | (Stripe.PaymentIntent & { client_secret?: string }) | null,
    };
    const invoice = latestInvoice as InvoiceWithExtras;
    const confirmationSecret = invoice.confirmation_secret?.client_secret;
    const piSecret = typeof invoice.payment_intent !== "string" ? invoice.payment_intent?.client_secret : undefined;
    if (typeof confirmationSecret === "string") return confirmationSecret;
    if (typeof piSecret === "string") return piSecret;
  }
  throwErr(500, "No client secret returned from Stripe for subscription");
}
