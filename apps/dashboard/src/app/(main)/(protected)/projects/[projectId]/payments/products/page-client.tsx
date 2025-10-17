"use client";

import { useState } from "react";
import { AppEnabledGuard } from "../../app-enabled-guard";
import PageClientCatalogsView from "./page-client-catalogs-view";
import PageClientListView from "./page-client-list-view";

export default function PageClient() {
  const [view, setView] = useState<"list" | "catalogs">("catalogs");

  return (
    <AppEnabledGuard appId="payments">
      {view === "catalogs" ? (
        <PageClientCatalogsView onViewChange={setView} />
      ) : (
        <PageClientListView onViewChange={setView} />
      )}
    </AppEnabledGuard>
  );
}
