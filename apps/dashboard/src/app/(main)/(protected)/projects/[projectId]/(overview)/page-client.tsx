'use client';

import { stackAppInternalsSymbol } from "@/app/(main)/integrations/transfer-confirm-page";
import { useState } from "react";
import { useAdminApp } from "../use-admin-app";
import MetricsPage from "./(metrics)/metrics-page";
import SetupPage from "./(setup)/setup-page";

export default function PageClient() {
  const adminApp = useAdminApp();
  const data = (adminApp as any)[stackAppInternalsSymbol].useMetrics();
  const [page, setPage] = useState<'setup' | 'metrics'>(data.total_users === 0 ? 'setup' : 'metrics');

  switch (page) {
    case 'setup': {
      return <SetupPage toMetrics={() => setPage('metrics')} />;
    }
    case 'metrics': {
      return <MetricsPage toSetup={() => setPage('setup')} />;
    }
  }
}
