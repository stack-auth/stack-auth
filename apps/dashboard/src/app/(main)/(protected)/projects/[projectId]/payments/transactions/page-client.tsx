"use client";

import { TransactionTable } from "@/components/data-table/transaction-table";
import { AppEnabledGuard } from "../../app-enabled-guard";
import { PageLayout } from "../../page-layout";

export default function PageClient() {
  return (
    <AppEnabledGuard appId="payments">
      <PageLayout title="Transactions">
        <TransactionTable />
      </PageLayout>
    </AppEnabledGuard>
  );
}
