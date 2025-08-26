"use client";

import { PaymentItemTable } from "@/components/data-table/payment-item-table";
import { ItemDialog } from "@/components/payments/item-dialog";
import { PageLayout } from "../../page-layout";
import { useAdminApp } from "../../use-admin-app";
import { DialogOpener } from "@/components/dialog-opener";


export default function PageClient() {
  const stackAdminApp = useAdminApp();
  const project = stackAdminApp.useProject();
  const config = project.useConfig();
  const paymentsConfig = config.payments;

  return (
    <PageLayout
      title="Items"
      description="Manage your payment items"
      actions={
        <DialogOpener triggerLabel="New Item">
          {state => (
            <ItemDialog
              open={state.isOpen}
              onOpenChange={state.setIsOpen}
              project={project}
              mode="create"
            />
          )}
        </DialogOpener>
      }
    >
      <PaymentItemTable items={paymentsConfig.items} />
    </PageLayout>
  );
}

