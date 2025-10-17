"use client";

import { useState } from "react";
import PageClientCatalogsView from "./page-client-catalogs-view";
import PageClientListView from "./page-client-list-view";

export default function PageClient() {
  const [view, setView] = useState<"list" | "catalogs">("catalogs");

  return view === "catalogs" ? (
    <PageClientCatalogsView onViewChange={setView} />
  ) : (
    <PageClientListView onViewChange={setView} />
  );
}
