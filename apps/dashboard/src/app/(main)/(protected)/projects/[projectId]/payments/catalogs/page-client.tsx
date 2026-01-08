"use client";

import { Button } from "@/components/ui";
import { PlusIcon } from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import { IllustratedInfo } from "../../../../../../../components/illustrated-info";
import { PageLayout } from "../../page-layout";
import { useAdminApp } from "../../use-admin-app";
import PageClientCatalogsView from "../products/page-client-catalogs-view";

function generateTriggerId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function WelcomeScreen({ onCreateProduct }: { onCreateProduct: () => void }) {
  return (
    <PageLayout title="Catalogs" description="Set up your pricing table by creating catalogs and products.">
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
          title="Welcome to Catalogs!"
          description={[
            <>Catalogs group products that are mutually exclusive — customers can only have one active product from each catalog at a time.</>,
            <>Products are what customers buy — the columns in your pricing table. Each product has one or more prices.</>,
            <>Items are what customers receive — the rows in your pricing table. They unlock features, limits, or usage metering.</>,
            <>Create your first product to get started!</>,
          ]}
        />
        <Button className="mt-8" onClick={onCreateProduct}>
          <PlusIcon className="h-4 w-4 mr-2" />
          Create Your First Product
        </Button>
      </div>
    </PageLayout>
  );
}

export default function PageClient() {
  const [welcomeDismissed, setWelcomeDismissed] = useState(false);
  const [draftCustomerType, setDraftCustomerType] = useState<'user' | 'team' | 'custom'>("user");
  const [draftRequestId, setDraftRequestId] = useState<string | undefined>(undefined);

  const adminApp = useAdminApp();
  const paymentsConfig = adminApp.useProject().useConfig().payments;

  const hasAnyProductsOrItems = useMemo(() => {
    return (
      Object.keys(paymentsConfig.products).length > 0 ||
      Object.keys(paymentsConfig.items).length > 0
    );
  }, [paymentsConfig.products, paymentsConfig.items]);

  const showWelcome = !welcomeDismissed && !hasAnyProductsOrItems;

  const handleCreateFirstProduct = () => {
    setWelcomeDismissed(true);
    setDraftCustomerType("user");
    setDraftRequestId(generateTriggerId());
  };

  const handleDraftHandled = () => {
    setDraftRequestId(undefined);
  };

  if (showWelcome) {
    return <WelcomeScreen onCreateProduct={handleCreateFirstProduct} />;
  }

  return (
    <PageLayout title='Catalogs' description="Mutually exclusive sets of products. Customers can purchase one product of each catalog.">
      <PageClientCatalogsView
        createDraftRequestId={draftRequestId}
        draftCustomerType={draftCustomerType}
        onDraftHandled={handleDraftHandled}
      />
    </PageLayout>
  );
}

