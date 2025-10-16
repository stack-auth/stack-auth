"use client";

import { useEffect, useState } from "react";
import { Button } from "@stackframe/stack-ui";
import { Plus } from "lucide-react";
import PageClientListView from "./page-client-list-view";
import PageClientCatalogsView from "./page-client-catalogs-view";
import { IllustratedInfo } from "../../../../../../../components/illustrated-info";
import { useAdminApp } from "./use-admin-app";

function WelcomeScreen({ onCreateProduct }: { onCreateProduct: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center h-full px-4 py-12 max-w-3xl mx-auto">
      <IllustratedInfo
        illustration={(
          <div className="grid grid-cols-3 gap-2">
            <div className="bg-background rounded p-3 shadow-sm">
              <div className="h-2 bg-muted rounded mb-2"></div>
              <div className="h-8 bg-primary/20 rounded mb-2"></div>
              <div className="space-y-1">
                <div className="h-1.5 bg-muted rounded"></div>
                <div className="h-1.5 bg-muted rounded"></div>
                <div className="h-1.5 bg-muted rounded"></div>
              </div>
            </div>
            <div className="bg-background rounded p-3 shadow-sm border-2 border-primary">
              <div className="h-2 bg-muted rounded mb-2"></div>
              <div className="h-8 bg-primary/40 rounded mb-2"></div>
              <div className="space-y-1">
                <div className="h-1.5 bg-muted rounded"></div>
                <div className="h-1.5 bg-muted rounded"></div>
                <div className="h-1.5 bg-muted rounded"></div>
              </div>
            </div>
            <div className="bg-background rounded p-3 shadow-sm">
              <div className="h-2 bg-muted rounded mb-2"></div>
              <div className="h-8 bg-primary/20 rounded mb-2"></div>
              <div className="space-y-1">
                <div className="h-1.5 bg-muted rounded"></div>
                <div className="h-1.5 bg-muted rounded"></div>
                <div className="h-1.5 bg-muted rounded"></div>
              </div>
            </div>
          </div>
        )}
        title="Welcome to Payments!"
        description={[
          "Stack Auth Payments is built on two primitives: products and items.",
          "Products are what customers buy — the columns of your pricing table. Each product has one or more prices and may or may not include items.",
          "Items are what customers receive — the rows of your pricing table. A user can hold multiple of the same item. Items are powerful; they can unlock feature access, raise limits, or meter consumption for usage-based billing.",
          "Create your first product to get started!",
        ]}
      />
      <Button onClick={onCreateProduct}>
        <Plus className="h-4 w-4 mr-2" />
        Create Your First Product
      </Button>
    </div>
  );
}

export default function PageClient() {
  const [view, setView] = useState<"list" | "catalogs">("catalogs");
  const [createDraftTrigger, setCreateDraftTrigger] = useState<number | null>(null);
  const [isCreatingFirstProduct, setIsCreatingFirstProduct] = useState(false);
  const stackAdminApp = useAdminApp();
  const project = stackAdminApp.useProject();
  const config = project.useConfig();
  const paymentsConfig = config.payments;

  const hasNoProductsAndNoItems = Object.keys(paymentsConfig.products).length === 0 && Object.keys(paymentsConfig.items).length === 0;

  useEffect(() => {
    if (!hasNoProductsAndNoItems) {
      setIsCreatingFirstProduct(false);
      setCreateDraftTrigger(null);
    }
  }, [hasNoProductsAndNoItems]);

  const handleCreateFirstProduct = () => {
    setIsCreatingFirstProduct(true);
    setView("catalogs");
    setCreateDraftTrigger((prev) => (prev ?? 0) + 1);
  };

  if (hasNoProductsAndNoItems && !isCreatingFirstProduct) {
    return <WelcomeScreen onCreateProduct={handleCreateFirstProduct} />;
  }

  if (view === "catalogs") {
    return <PageClientCatalogsView onViewChange={setView} createDraftTrigger={createDraftTrigger ?? undefined} />;
  }

  return <PageClientListView onViewChange={setView} />;
}
