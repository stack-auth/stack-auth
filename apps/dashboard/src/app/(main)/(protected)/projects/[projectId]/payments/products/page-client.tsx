"use client";

import { PageLayout } from "../../page-layout";
import PageClientListView from "./page-client-list-view";

export default function PageClient() {
  return (
    <PageLayout title='Products & Items'>
      <PageClientListView />
    </PageLayout>
  );
}
