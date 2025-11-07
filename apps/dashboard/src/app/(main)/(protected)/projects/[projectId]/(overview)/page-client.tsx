'use client';

import { useState } from "react";
import { useAdminApp } from "../use-admin-app";
import MetricsPage from "./metrics-page";
import SetupPage from "./setup-page";

export default function PageClient() {
  const adminApp = useAdminApp();
  const users = adminApp.useUsers({ limit: 1 });
  const [page, setPage] = useState<'setup' | 'metrics'>(users.length === 0 ? 'setup' : 'metrics');

  switch (page) {
    case 'setup': {
      return <SetupPage toMetrics={() => setPage('metrics')} />;
    }
    case 'metrics': {
      return <MetricsPage toSetup={() => setPage('setup')} />;
    }
  }
}
