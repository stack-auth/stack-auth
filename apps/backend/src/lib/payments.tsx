import { teamsCrudHandlers } from "@/app/api/latest/teams/crud";
import { usersCrudHandlers } from "@/app/api/latest/users/crud";
import { KnownErrors } from "@stackframe/stack-shared";
import { inlineOfferSchema, offerSchema } from "@stackframe/stack-shared/dist/schema-fields";
import { StackAssertionError, StatusError } from "@stackframe/stack-shared/dist/utils/errors";
import { getOrUndefined, typedFromEntries } from "@stackframe/stack-shared/dist/utils/objects";
import * as yup from "yup";
import { Tenancy } from "./tenancies";
import { SUPPORTED_CURRENCIES } from "@stackframe/stack-shared/dist/utils/currencies";
import { SubscriptionStatus } from "@prisma/client";
import { PrismaClientTransaction } from "@/prisma-client";

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
        quantity: value.quantity,
        expires: value.expires ?? "never",
      }])),
    };
  }
}

export async function ensureItemCustomerTypeMatches(itemId: string, itemCustomerType: "user" | "team" | undefined, customerId: string, tenancy: Tenancy) {
  const actualCustomerType = await getCustomerType(tenancy, customerId);
  if (itemCustomerType !== actualCustomerType) {
    throw new KnownErrors.ItemCustomerTypeDoesNotMatch(itemId, customerId, itemCustomerType, actualCustomerType);
  }
}

export async function ensureOfferCustomerTypeMatches(offerId: string | undefined, offerCustomerType: "user" | "team" | undefined, customerId: string, tenancy: Tenancy) {
  const actualCustomerType = await getCustomerType(tenancy, customerId);
  if (offerCustomerType !== actualCustomerType) {
    throw new KnownErrors.OfferCustomerTypeDoesNotMatch(offerId, customerId, offerCustomerType, actualCustomerType);
  }
}

export async function getCustomerType(tenancy: Tenancy, customerId: string) {
  let user;
  try {
    user = await usersCrudHandlers.adminRead(
      {
        user_id: customerId,
        tenancy,
        allowedErrorTypes: [
          KnownErrors.UserNotFound,
        ],
      }
    );
  } catch (e) {
    if (KnownErrors.UserNotFound.isInstance(e)) {
      user = null;
    } else {
      throw e;
    }
  }
  let team;
  try {
    team = await teamsCrudHandlers.adminRead({
      team_id: customerId,
      tenancy,
      allowedErrorTypes: [
        KnownErrors.TeamNotFound,
      ],
    });
  } catch (e) {
    if (KnownErrors.TeamNotFound.isInstance(e)) {
      team = null;
    } else {
      throw e;
    }
  }

  if (user && team) {
    throw new StackAssertionError("Found a customer that is both user and team at the same time? This should never happen!", { customerId, user, team, tenancy });
  }

  if (user) {
    return "user";
  }
  if (team) {
    return "team";
  }
  throw new KnownErrors.CustomerDoesNotExist(customerId);
}

export async function getItemQuantityForCustomer(options: {
  prisma: PrismaClientTransaction,
  tenancy: Tenancy,
  itemId: string,
  customerId: string,
}) {
  const itemConfig = getOrUndefined(options.tenancy.config.payments.items, options.itemId);
  const defaultQuantity = itemConfig?.default.quantity ?? 0;
  const subscriptions = await options.prisma.subscription.findMany({
    where: {
      tenancyId: options.tenancy.id,
      customerId: options.customerId,
      status: {
        in: [SubscriptionStatus.active, SubscriptionStatus.trialing],
      }
    },
  });

  const subscriptionQuantity = subscriptions.reduce((acc, subscription) => {
    const offer = subscription.offer as yup.InferType<typeof offerSchema>;
    const item = getOrUndefined(offer.includedItems, options.itemId);
    return acc + (item?.quantity ?? 0);
  }, 0);

  const { _sum } = await options.prisma.itemQuantityChange.aggregate({
    where: {
      tenancyId: options.tenancy.id,
      customerId: options.customerId,
      itemId: options.itemId,
      OR: [
        { expiresAt: null },
        { expiresAt: { gt: new Date() } },
      ],
    },
    _sum: {
      quantity: true,
    },
  });
  return subscriptionQuantity + (_sum.quantity ?? 0) + defaultQuantity;
}
