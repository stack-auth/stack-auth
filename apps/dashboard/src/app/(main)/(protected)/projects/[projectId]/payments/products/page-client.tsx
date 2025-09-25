"use client";

import { useState } from "react";
import PageClientListView from "./page-client-list-view";
import PageClientCatalogsView from "./page-client-catalogs-view";

export default function PageClient() {
  const [view, setView] = useState<"list" | "catalogs">("catalogs");

  if (view === "catalogs") {
    return <PageClientCatalogsView onViewChange={setView} />;
  }
  return <PageClientListView onViewChange={setView} />;
}
