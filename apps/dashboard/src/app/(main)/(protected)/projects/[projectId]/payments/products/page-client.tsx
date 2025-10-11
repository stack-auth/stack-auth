"use client";

import { useQueryState } from "@stackframe/stack-shared/dist/utils/react";
import { Label, Separator, Switch, toast } from "@stackframe/stack-ui";
import { useId } from "react";
import { PageLayout } from "../../page-layout";
import { useAdminApp } from "../../use-admin-app";
import PageClientCatalogsView from "./page-client-catalogs-view";
import PageClientListView from "./page-client-list-view";

export default function PageClient() {
  const [view, setView] = useQueryState("view", "catalogs");
  const isViewList = view === "list";
  const switchId = useId();
  const testModeSwitchId = useId();
  const project = useAdminApp().useProject();
  const paymentsConfig = project.useConfig().payments;

  const handleToggleTestMode = async (enabled: boolean) => {
    try {
      await project.updateConfig({ "payments.testMode": enabled });
      toast({ title: enabled ? "Test mode enabled" : "Test mode disabled" });
    } catch (_error) {
      alert("Failed to update test mode");
    }
  };

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
      {isViewList ? <PageClientListView /> : <PageClientCatalogsView />}
    </PageLayout>
  );
}
