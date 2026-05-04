import { ItemId } from "@stackframe/stack-shared/dist/plans";
import { StackAssertionError } from "@stackframe/stack-shared/dist/utils/errors";
import { wait } from "@stackframe/stack-shared/dist/utils/promises";
import { niceBackendFetch, withInternalProject } from "./backend-helpers";

// Helpers for reading and waiting on payment-item quantities held by an
// owner team in the internal project (the "billing team" of a Stack Auth
// customer's project). Used by tests that need to assert against post-grant
// quota state without sleeping for arbitrarily-large fixed durations.

/**
 * Fetches the current quantity of a payment item. Throws if the API call
 * fails (e.g. tenancy/team misconfigured).
 */
export async function getItemQuantity(ownerTeamId: string, itemId: ItemId): Promise<number> {
  return await withInternalProject(async () => {
    const response = await niceBackendFetch(`/api/v1/payments/items/team/${ownerTeamId}/${itemId}`, {
      accessType: "server",
    });
    if (response.status !== 200) {
      throw new StackAssertionError(`Failed to fetch item quantity`, { ownerTeamId, itemId, response });
    }
    return response.body.quantity as number;
  });
}

/**
 * Sets the quantity of a payment item to an exact value by computing and
 * applying the delta from the current value. Used in tests to force the
 * quota into a known state. `allow_negative=true` so callers can drive the
 * quota past zero when they need to.
 */
export async function setItemQuantity(ownerTeamId: string, itemId: ItemId, quantity: number): Promise<void> {
  const current = await getItemQuantity(ownerTeamId, itemId);
  const delta = quantity - current;
  await withInternalProject(async () => {
    const response = await niceBackendFetch(
      `/api/v1/payments/items/team/${ownerTeamId}/${itemId}/update-quantity?allow_negative=true`,
      { method: "POST", accessType: "server", body: { delta } },
    );
    if (response.status !== 200) {
      throw new StackAssertionError(`Failed to set item quantity`, { ownerTeamId, itemId, quantity, response });
    }
  });
}

/**
 * Polls the item quantity every 200ms until it equals `expected`, then
 * returns. Throws if it doesn't get there within 8 seconds.
 *
 * Use this when you know the exact target value — for example, right after
 * granting a plan, the quota should equal that plan's allotment once
 * Bulldozer's timefold has materialised the entitlement.
 */
export async function waitForItemQuantityToReach(
  ownerTeamId: string,
  itemId: ItemId,
  expected: number,
): Promise<void> {
  const pollIntervalMs = 200;
  const timeoutMs = 8000;
  const startedAt = performance.now();

  while (true) {
    const current = await getItemQuantity(ownerTeamId, itemId);
    if (current === expected) return;

    if (performance.now() - startedAt > timeoutMs) {
      throw new StackAssertionError(`Item quantity did not reach expected value within timeout`, {
        ownerTeamId, itemId, expected, current, timeoutMs,
      });
    }

    await wait(pollIntervalMs);
  }
}

/**
 * Polls the item quantity every 500ms until it stops changing for 8 reads
 * in a row (~4 seconds of no movement), then returns the stable value.
 * Throws if no stable value is observed within 15 seconds.
 *
 * Use this when you DON'T know the exact target — for example, after
 * `Auth.Otp.signIn()` triggers an unknown number of async logEvent debits
 * (token-refresh + sign-up-rule events) and you just want them to drain
 * before measuring a baseline.
 *
 * The 4-second stability window is deliberately conservative: a shorter
 * one (we tried 1.2s) exits during brief lulls between batches of late-
 * arriving sign-up-rule debits and lets ~2 extra debits land between the
 * baseline read and the next test request, breaking exact-quota
 * assertions.
 */
export async function waitForItemQuantityToStabilize(
  ownerTeamId: string,
  itemId: ItemId,
): Promise<number> {
  const pollIntervalMs = 500;
  const stableForReads = 8;
  const timeoutMs = 15000;
  const startedAt = performance.now();

  let last = await getItemQuantity(ownerTeamId, itemId);
  let stableReads = 1;

  while (stableReads < stableForReads) {
    if (performance.now() - startedAt > timeoutMs) {
      throw new StackAssertionError(`Item quantity did not stabilise within timeout`, {
        ownerTeamId, itemId, last, stableReads, stableForReads, timeoutMs,
      });
    }

    await wait(pollIntervalMs);
    const next = await getItemQuantity(ownerTeamId, itemId);

    if (next === last) {
      stableReads++;
    } else {
      stableReads = 1;
      last = next;
    }
  }

  return last;
}
