"use client";

import { useCallback, useEffect, useState } from "react";
import { useAdminApp } from "../../use-admin-app";
import PageClientCatalogsView from "./page-client-catalogs-view";
import PageClientListView from "./page-client-list-view";
import { WelcomeScreen } from "./page-client-welcome-screen";

export default function PageClient() {
  const [view, setView] = useState<"list" | "catalogs">("catalogs");
  const [welcomeDismissed, setWelcomeDismissed] = useState(false);
  const [createProductRequest, setCreateProductRequest] = useState<number | null>(null);

  const stackAdminApp = useAdminApp();
  const project = stackAdminApp.useProject();
  const config = project.useConfig();
  const paymentsConfig = config.payments;

  const hasNoProductsAndNoItems =
    Object.keys(paymentsConfig.products).length === 0 &&
    Object.keys(paymentsConfig.items).length === 0;

  useEffect(() => {
    if (!hasNoProductsAndNoItems && welcomeDismissed) {
      setWelcomeDismissed(false);
    }
  }, [hasNoProductsAndNoItems, welcomeDismissed]);

  const handleStartFirstProduct = useCallback(() => {
    setWelcomeDismissed(true);
    setView("catalogs");
    setCreateProductRequest(Date.now());
  }, []);

  const handleCreateProductHandled = useCallback(() => {
    setCreateProductRequest(null);
  }, []);

  if (hasNoProductsAndNoItems && !welcomeDismissed) {
    return <WelcomeScreen onCreateProduct={handleStartFirstProduct} />;
  }

  if (view === "catalogs") {
    return (
      <PageClientCatalogsView
        onViewChange={setView}
        createProductRequest={createProductRequest}
        onCreateProductRequestHandled={handleCreateProductHandled}
      />
    );
  }

  return <PageClientListView onViewChange={setView} />;
}
