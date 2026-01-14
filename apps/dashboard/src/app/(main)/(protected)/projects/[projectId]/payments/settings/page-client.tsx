"use client";

import { PageLayout } from "../../page-layout";
import { PaymentMethods } from "./payment-methods";
import { StripeConnectionCheck } from "./stripe-connection-check";
import { TestModeToggle } from "./test-mode-toggle";

export default function PageClient() {
  return (
    <PageLayout title="Payment Settings">
      <div className="space-y-6 max-w-3xl">
        <StripeConnectionCheck />
        <TestModeToggle />
        <PaymentMethods />
      </div>
    </PageLayout>
  );
}
