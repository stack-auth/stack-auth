import { EvaluatedAutomationDecision } from "./rule-evaluator";

export type PaymentsItemQuotaSourceApiBody = {
  type: "payments-item-quota",
  item_id: string,
  current_quantity: number,
  entitlement_quantity: number | null,
  threshold_kind: "near" | "over",
  owned_product_ids: string[],
  active_subscription_ids: string[],
};

export function paymentsItemQuotaSourceSnapshotToApiBody(
  decision: EvaluatedAutomationDecision,
  context: string,
): PaymentsItemQuotaSourceApiBody {
  return {
    type: "payments-item-quota",
    item_id: getStringSourceSnapshotValue(decision, "itemId", context),
    current_quantity: getNumberSourceSnapshotValue(decision, "currentQuantity", context),
    entitlement_quantity: getNullableNumberSourceSnapshotValue(decision, "entitlementQuantity", context),
    threshold_kind: decision.signal.kind,
    owned_product_ids: getStringArraySourceSnapshotValue(decision, "ownedProductIds", context),
    active_subscription_ids: getStringArraySourceSnapshotValue(decision, "activeSubscriptionIds", context),
  };
}

function getStringSourceSnapshotValue(decision: EvaluatedAutomationDecision, key: string, context: string) {
  const value = decision.sourceSnapshot[key];
  if (typeof value !== "string") {
    throw new Error(`${context} sourceSnapshot.${key} must be a string.`);
  }
  return value;
}

function getNumberSourceSnapshotValue(decision: EvaluatedAutomationDecision, key: string, context: string) {
  const value = decision.sourceSnapshot[key];
  if (typeof value !== "number") {
    throw new Error(`${context} sourceSnapshot.${key} must be a number.`);
  }
  return value;
}

function getNullableNumberSourceSnapshotValue(decision: EvaluatedAutomationDecision, key: string, context: string) {
  const value = decision.sourceSnapshot[key];
  if (value !== null && typeof value !== "number") {
    throw new Error(`${context} sourceSnapshot.${key} must be a number or null.`);
  }
  return value;
}

function getStringArraySourceSnapshotValue(decision: EvaluatedAutomationDecision, key: string, context: string) {
  const value = decision.sourceSnapshot[key];
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string")) {
    throw new Error(`${context} sourceSnapshot.${key} must be an array of strings.`);
  }
  return value;
}
