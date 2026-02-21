import { Tenancy } from "@/lib/tenancies";
import type { Transaction } from "@stackframe/stack-shared/dist/interface/crud/transactions";
import { PaginatedList } from "@stackframe/stack-shared/dist/utils/paginated-lists";
import type { TransactionFilter, TransactionOrderBy } from "./helpers";
import { getChargebackTransactions } from "./types/chargeback";
import { getDefaultProductsChangeTransactions } from "./types/default-products-change";
import { getItemGrantRenewalTransactions } from "./types/item-grant-renewal";
import { getManualItemQuantityChangeTransactions } from "./types/manual-item-quantity-change";
import { getOneTimePurchaseTransactions } from "./types/one-time-purchase";
import { getProductVersionChangeTransactions } from "./types/product-version-change";
import { getPurchaseRefundTransactions } from "./types/purchase-refund";
import { getSubscriptionCancelTransactions } from "./types/subscription-cancel";
import { getSubscriptionChangeTransactions } from "./types/subscription-change";
import { getSubscriptionEndTransactions } from "./types/subscription-end";
import { getSubscriptionReactivationTransactions } from "./types/subscription-reactivation";
import { getSubscriptionRenewalTransactions } from "./types/subscription-renewal";
import { getSubscriptionStartTransactions } from "./types/subscription-start";

export { refundTransaction } from "./refund";

type FullTransactionFilter = TransactionFilter & {
  type?: Transaction["type"],
};

export function getTransactionsPaginatedList(tenancy: Tenancy): PaginatedList<Transaction, string, FullTransactionFilter, TransactionOrderBy> {
  return PaginatedList.merge(
    getSubscriptionStartTransactions(tenancy),
    getOneTimePurchaseTransactions(tenancy),
    getSubscriptionRenewalTransactions(tenancy),
    getSubscriptionEndTransactions(tenancy),
    getSubscriptionCancelTransactions(tenancy),
    getSubscriptionReactivationTransactions(tenancy),
    getPurchaseRefundTransactions(tenancy),
    getManualItemQuantityChangeTransactions(tenancy),
    getItemGrantRenewalTransactions(tenancy),
    getDefaultProductsChangeTransactions(tenancy),
    getChargebackTransactions(tenancy),
    getProductVersionChangeTransactions(tenancy),
    getSubscriptionChangeTransactions(tenancy),
  ).addFilter({
    filter: (item, f) => !f.type || item.type === f.type,
    estimateItemsToFetch: ({ limit }) => limit * 2,
  });
}
