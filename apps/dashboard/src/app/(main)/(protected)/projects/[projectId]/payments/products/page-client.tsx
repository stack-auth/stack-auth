"use client";

import { Link } from "@/components/link";
import { Button } from "@stackframe/stack-ui";
import { Plus } from "lucide-react";
import { useMemo } from "react";
import { IllustratedInfo } from "../../../../../../../components/illustrated-info";
import { PageLayout } from "../../page-layout";
import { useAdminApp, useProjectId } from "../../use-admin-app";
import PageClientListView from "./page-client-list-view";

function WelcomeScreen({ projectId }: { projectId: string }) {
  return (
    <PageLayout title="Products & Items" description="Manage your products and items.">
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
          title="Welcome to Products & Items!"
          description={[
            <>Products are what customers buy — each product has one or more prices.</>,
            <>Items are what customers receive — they unlock features, limits, or usage metering.</>,
            <>Create your first product to get started!</>,
          ]}
        />
        <Link href={`/projects/${projectId}/payments/products/new`}>
          <Button className="mt-8">
            <Plus className="h-4 w-4 mr-2" />
            Create Your First Product
          </Button>
        </Link>
      </div>
    </PageLayout>
  );
}

export default function PageClient() {
  const projectId = useProjectId();
  const adminApp = useAdminApp();
  const paymentsConfig = adminApp.useProject().useConfig().payments;

  const hasAnyProductsOrItems = useMemo(() => {
    return (
      Object.keys(paymentsConfig.products).length > 0 ||
      Object.keys(paymentsConfig.items).length > 0
    );
  }, [paymentsConfig.products, paymentsConfig.items]);

  if (!hasAnyProductsOrItems) {
    return <WelcomeScreen projectId={projectId} />;
  }

  return (
    <PageLayout title='Products & Items'>
      <PageClientListView />
    </PageLayout>
  );
}
