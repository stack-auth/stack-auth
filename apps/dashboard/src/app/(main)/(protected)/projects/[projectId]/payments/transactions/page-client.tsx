"use client";

import { TransactionTable } from "@/components/data-table/transaction-table";
import { ExportTransactionsDialog, type ExportTransactionsOptions } from "@/components/export-transactions-dialog";
import { Button } from "@/components/ui";
import { DownloadSimpleIcon } from "@phosphor-icons/react";
import { useCallback, useState } from "react";
import { PageLayout } from "../../page-layout";

export default function PageClient() {
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [exportOptions, setExportOptions] = useState<ExportTransactionsOptions>({});
  const openExportDialog = useCallback(() => {
    setExportDialogOpen(true);
  }, []);

  return (
    <PageLayout
      title="Transactions"
      actions={
        <ExportTransactionsDialog
          trigger={
            <Button variant="outline">
              <DownloadSimpleIcon className="mr-2 h-4 w-4" />
              Export
            </Button>
          }
          exportOptions={exportOptions}
          open={exportDialogOpen}
          onOpenChange={setExportDialogOpen}
        />
      }
    >
      <TransactionTable onFilterChange={setExportOptions} onExportClick={openExportDialog} />
    </PageLayout>
  );
}
