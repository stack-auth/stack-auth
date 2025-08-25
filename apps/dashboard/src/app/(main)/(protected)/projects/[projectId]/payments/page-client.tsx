"use client";

import { ConnectPayments } from "@stripe/react-connect-js";
import { PageLayout } from "../page-layout";

export default function PageClient() {
  return (
    <PageLayout
      title="Payments"
    >
      <div className="flex justify-center">
        <div style={{ maxWidth: 1250, width: '100%' }}>
          <ConnectPayments />
        </div>
      </div>
    </PageLayout >
  );
}
