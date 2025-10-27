"use client";

import { useQueryState } from "@stackframe/stack-shared/dist/utils/react";
import { Button, Label, Separator, Switch, toast } from "@stackframe/stack-ui";
import { Plus } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { IllustratedInfo } from "../../../../../../../components/illustrated-info";
import { PageLayout } from "../../page-layout";
import { useAdminApp } from "../../use-admin-app";
import PageClientCatalogsView from "./page-client-catalogs-view";
import PageClientListView from "./page-client-list-view";

type ViewState = "list" | "catalogs";

function generateTriggerId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function WelcomeScreen({ onCreateProduct }: { onCreateProduct: () => void }) {
  return (
    <PageLayout title="Payments" description="Set up your pricing table by creating products and items.">
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
            <>Stack Payments is built on two primitives: products and items.</>,
            <>Products are what customers buy — the columns in your pricing table. Each product has one or more prices.</>,
            <>Items are what customers receive — the rows in your pricing table. They unlock features, limits, or usage metering.</>,
            <>Create your first product to get started!</>,
          ]}
        />
        <Button className="mt-8" onClick={onCreateProduct}>
          <Plus className="h-4 w-4 mr-2" />
          Create Your First Product
        </Button>
      </div>
    </PageLayout>
  );
}

export default function PageClient() {
  const [view, setView] = useQueryState("view", "catalogs");
  const isViewList = view === "list";
  const [welcomeDismissed, setWelcomeDismissed] = useState(false);
  const [draftCustomerType, setDraftCustomerType] = useState<'user' | 'team' | 'custom'>("user");
  const [draftRequestId, setDraftRequestId] = useState<string | undefined>(undefined);
  const switchId = useId();
  const testModeSwitchId = useId();

  const adminApp = useAdminApp();
  const project = adminApp.useProject();
  const paymentsConfig = project.useConfig().payments;

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
    setView("catalogs");
    setDraftRequestId(generateTriggerId());
  };

  const handleDraftHandled = () => {
    setDraftRequestId(undefined);
  };


  const handleToggleTestMode = async (enabled: boolean) => {
    await project.updateConfig({ "payments.testMode": enabled });
    toast({ title: enabled ? "Test mode enabled" : "Test mode disabled" });
  };


  if (showWelcome) {
    return <WelcomeScreen onCreateProduct={handleCreateFirstProduct} />;
  }

  return (
    <PageLayout
      title='Products'
      actions={
        <div className="flex items-center gap-4 self-center">
          <div className="flex items-center gap-2">
            <Label htmlFor={switchId}>Pricing table</Label>
            <Switch id={switchId} checked={isViewList} onCheckedChange={() => setView(isViewList ? "catalogs" : "list")} />
            <Label htmlFor={switchId}>List</Label>
          </div>
          <Separator orientation="vertical" className="h-6" />
          <div className="flex items-center gap-2">
            <Label htmlFor={testModeSwitchId}>Test mode</Label>
            <Switch
              id={testModeSwitchId}
              checked={paymentsConfig.testMode === true}
              onCheckedChange={async (checked) => await handleToggleTestMode(checked)}
            />
          </div>
        </div>
      }
    >
      {isViewList ? (
        <PageClientCatalogsView
          createDraftRequestId={draftRequestId}
          draftCustomerType={draftCustomerType}
          onDraftHandled={handleDraftHandled}
        />

      ) : (
        <PageClientListView />
      )}
    </PageLayout>
  );
}
