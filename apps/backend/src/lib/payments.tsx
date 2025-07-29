import { teamsCrudHandlers } from "@/app/api/latest/teams/crud";
import { usersCrudHandlers } from "@/app/api/latest/users/crud";
import { KnownErrors } from "@stackframe/stack-shared";
import { StackAssertionError } from "@stackframe/stack-shared/dist/utils/errors";
import { Tenancy } from "./tenancies";

export async function ensureItemCustomerTypeMatches(itemId: string, itemCustomerType: "user" | "team" | undefined, customerId: string, tenancy: Tenancy) {
  const actualCustomerType = await getCustomerType(tenancy, customerId);
  if (itemCustomerType !== actualCustomerType) {
    throw new KnownErrors.ItemCustomerTypeDoesNotMatch(itemId, customerId, itemCustomerType, actualCustomerType);
  }
}

export async function ensureOfferCustomerTypeMatches(offerId: string, offerCustomerType: "user" | "team" | undefined, customerId: string, tenancy: Tenancy) {
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
