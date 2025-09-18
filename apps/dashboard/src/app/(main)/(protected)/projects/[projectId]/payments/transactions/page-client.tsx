"use client";

import { TransactionTable } from "@/components/data-table/transaction-table";
import { PageLayout } from "../../page-layout";

export default function PageClient() {
  return (
    <PageLayout title="Transactions">
      <TransactionTable />
    </PageLayout>
  );
}

