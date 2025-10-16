"use client";

import { useState } from "react";
import { Button } from "@stackframe/stack-ui";
import { Plus } from "lucide-react";
import { IllustratedInfo } from "../../../../../../../components/illustrated-info";
import { useAdminApp } from "../../use-admin-app";
import PageClientListView from "./page-client-list-view";
import PageClientCatalogsView from "./page-client-catalogs-view";

function WelcomeScreen({ onCreateProduct }: { onCreateProduct: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center h-full px-4 py-12 max-w-3xl mx-auto">
      <IllustratedInfo
        illustration={(
          <div className="grid grid-cols-3 gap-2">
            {/* Simple pricing table representation */}
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
          <>Stack Auth Payments is built on two primitives: products and items.</>,
          <>Products are what customers buy — the columns of your pricing table. Each product has one or more prices and may or may not include items.</>,
          <>Items are what customers receive — the rows of your pricing table. A user can hold multiple of the same item. Items are powerful; they can unlock feature access, raise limits, or meter consumption for usage-based billing.</>,
          <>Create your first product to get started!</>,
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
  const stackAdminApp = useAdminApp();
  const project = stackAdminApp.useProject();
  const config = project.useConfig();
  const paymentsConfig = config.payments;

  // Check if there are no products and no items
  const hasNoProductsAndNoItems = Object.keys(paymentsConfig.products).length === 0 && Object.keys(paymentsConfig.items).length === 0;

  // If no products and items, show welcome screen
  if (hasNoProductsAndNoItems) {
    return <PageClientCatalogsView onViewChange={setView} showWelcomeScreen={true} />;
  }

  if (view === "catalogs") {
    return <PageClientCatalogsView onViewChange={setView} />;
  }
  return <PageClientListView onViewChange={setView} />;
}
