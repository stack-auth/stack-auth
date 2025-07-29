import { teamsCrudHandlers } from "@/app/api/latest/teams/crud";
import { usersCrudHandlers } from "@/app/api/latest/users/crud";
import { KnownErrors } from "@stackframe/stack-shared";
import { inlineOfferSchema, yupValidate } from "@stackframe/stack-shared/dist/schema-fields";
import { StackAssertionError, StatusError } from "@stackframe/stack-shared/dist/utils/errors";
import { getOrUndefined } from "@stackframe/stack-shared/dist/utils/objects";
import * as yup from "yup";
import { Tenancy } from "./tenancies";

export async function ensureOfferIdOrInlineOffer(tenancy: Tenancy, accessType: "client" | "server" | "admin", offerId: string | undefined, inlineOffer: object | undefined): Promise<Tenancy["completeConfig"]["payments"]["offers"][string] | yup.InferType<typeof inlineOfferSchema>> {
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
    const offer = getOrUndefined(tenancy.completeConfig.payments.offers, offerId);
    if (!offer || (offer.serverOnly && accessType === "client")) {
      throw new KnownErrors.OfferDoesNotExist(offerId, accessType);
    }
    return offer;
  } else {
    // if we fail the validation here, we should throw an internal server error; inline offers should've been validated in the request schema already
    return await yupValidate(inlineOfferSchema, inlineOffer);
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
