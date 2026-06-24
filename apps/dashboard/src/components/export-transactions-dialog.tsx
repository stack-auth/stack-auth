"use client";

import { useAdminApp } from "@/app/(main)/(protected)/projects/[projectId]/use-admin-app";
import { ExportDataDialog, type ExportField } from "@/components/export-data-dialog";
import { getTransactionSummary } from "@/components/data-table/transaction-table";
import type { Transaction, TransactionType } from "@hexclave/shared/dist/interface/crud/transactions";
import type { ReactNode } from "react";

type CustomerType = "user" | "team" | "custom";

export type ExportTransactionsOptions = {
  type?: TransactionType,
  customerType?: CustomerType,
};

const TRANSACTION_EXPORT_FIELDS: ExportField<Transaction>[] = [
  { key: "id", label: "Transaction ID", enabled: true, getValue: (transaction) => transaction.id },
  { key: "type", label: "Type", enabled: true, getValue: (transaction) => getTransactionSummary(transaction).displayType.label },
  { key: "customerType", label: "Customer Type", enabled: true, getValue: (transaction) => getTransactionSummary(transaction).customerType ?? "" },
  { key: "customerId", label: "Customer ID", enabled: true, getValue: (transaction) => getTransactionSummary(transaction).customerId ?? "" },
  { key: "amount", label: "Amount", enabled: true, getValue: (transaction) => getTransactionSummary(transaction).amountDisplay },
  { key: "detail", label: "Detail", enabled: true, getValue: (transaction) => getTransactionSummary(transaction).detail },
  { key: "createdAt", label: "Created At", enabled: true, getValue: (transaction) => new Date(transaction.created_at_millis).toISOString() },
  { key: "refunded", label: "Refunded", enabled: true, getValue: (transaction) => getTransactionSummary(transaction).refunded ? "Yes" : "No" },
];

export function ExportTransactionsDialog(props: {
  trigger?: ReactNode,
  exportOptions?: ExportTransactionsOptions,
  open?: boolean,
  onOpenChange?: (open: boolean) => void,
}) {
  const hexclaveAdminApp = useAdminApp();

  return (
    <ExportDataDialog
      trigger={props.trigger}
      open={props.open}
      onOpenChange={props.onOpenChange}
      title="Export Transactions"
      description="Configure and download transaction data from your project"
      entityName="transaction"
      entityNamePlural="transactions"
      filenamePrefix="stack-transactions-export"
      fields={TRANSACTION_EXPORT_FIELDS}
      fetchRows={async ({ scope, onProgress }) => await fetchAllTransactions(
        hexclaveAdminApp,
        scope === "filtered" ? props.exportOptions : undefined,
        onProgress,
      )}
      emptyExportTitle="No transactions to export"
      emptyExportDescription="There are no transactions matching the current filters"
      allScopeLabel="Export all transactions in the project"
      filteredScopeLabel="Export only filtered transactions"
    />
  );
}

async function fetchAllTransactions(
  hexclaveAdminApp: ReturnType<typeof useAdminApp>,
  options: ExportTransactionsOptions | undefined,
  onProgress: (fetched: number) => void,
): Promise<Transaction[]> {
  const allTransactions: Transaction[] = [];
  let cursor: string | undefined = undefined;
  const limit = 100;

  do {
    const result = await hexclaveAdminApp.listTransactions({
      limit,
      cursor,
      type: options?.type,
      customerType: options?.customerType,
    });

    allTransactions.push(...result.transactions);
    onProgress(allTransactions.length);
    cursor = result.nextCursor ?? undefined;
  } while (cursor);

  return allTransactions;
}
