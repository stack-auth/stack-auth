'use client';

import { useUser } from "../../../lib/hooks";
import { useTranslation } from "../../../lib/translations";
import { PageLayout } from "../page-layout";
import { PaymentsPanel } from "./payments-panel";

export function PaymentsPage(props: { mockMode?: boolean }) {
  const { t } = useTranslation();
  const user = useUser({ or: props.mockMode ? "return-null" : "redirect" });

  if (props.mockMode) {
    return (
      <PageLayout>
        <PaymentsPanel
          title={t("Personal payments")}
          mockMode
        />
      </PageLayout>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <PageLayout>
      <PaymentsPanel
        title={t("Personal payments")}
        customer={user}
        customerType="user"
      />
    </PageLayout>
  );
}
