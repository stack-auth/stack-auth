"use client";

import { PaymentOfferTable } from "@/components/data-table/payment-offer-table";
import { OfferDialog } from "@/components/payments/offer-dialog";
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
      title="Offers"
      description="Manage your payment offers"
      actions={<DialogOpener triggerLabel="New Offer">
        {state => (
          <OfferDialog
            open={state.isOpen}
            onOpenChange={state.setIsOpen}
            project={project}
            mode="create"
          />
        )}
      </DialogOpener>}
    >
      <PaymentOfferTable offers={paymentsConfig.offers} />
    </PageLayout>
  );
}
