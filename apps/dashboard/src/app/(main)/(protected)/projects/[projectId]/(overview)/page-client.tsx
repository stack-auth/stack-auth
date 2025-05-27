'use client';

import { useState } from "react";
import { useAdminApp } from "../use-admin-app";
import MetricsPage from "./(metrics)/metrics-page";
import SetupPage from "./(setup)/setup-page";

export default function PageClient() {
  const adminApp = useAdminApp();
  const project = adminApp.useProject();
  const [page, setPage] = useState<'setup' | 'metrics'>(project.userCount === 0 ? 'setup' : 'metrics');

  switch (page) {
    case 'setup': {
      return <SetupPage toMetrics={() => setPage('metrics')} />;
    }
    case 'metrics': {
      return <MetricsPage toSetup={() => setPage('setup')} />;
    }
  }
}
