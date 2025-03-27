'use client';

import { useAdminApp } from "../use-admin-app";
import MetricsPage from "./metrics-page";
import SetupPage from "./setup-page";

export default function PageClient() {
  const adminApp = useAdminApp();
  const project = adminApp.useProject();

  if (project.userCount === 0) {
    return <SetupPage />;
  } else {
    return <MetricsPage />;
  }
}
