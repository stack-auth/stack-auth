"use client";

import { TransactionTable } from "@/components/data-table/transaction-table";
import { PageLayout } from "../../page-layout";

/**
 * @dashboardReference payments/transactions
 * @dashboardReferenceDescription Browse payment and subscription transactions for this project.
 *
 * ## Transactions table
 *
 * Uses the shared `TransactionTable` component: paginated `DataGrid` of purchases, refunds, and subscription events with filters and row detail. Sort and search state sync to the URL.
 *
 * Use **Customers** to grant products; this page is read-only history for reconciliation and support.
 */

export default function PageClient() {
  return (
    <PageLayout title="Transactions">
      <TransactionTable />
    </PageLayout>
  );
}
