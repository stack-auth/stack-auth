"use client";

import { TransactionTable } from "@/components/data-table/transaction-table";
import { useTranslations } from 'next-intl';
import { PageLayout } from "../../page-layout";

export default function PageClient() {
  const t = useTranslations('paymentsTransactions');
  return (
    <PageLayout title={t('title')}>
      <TransactionTable />
    </PageLayout>
  );
}

