import { ALL_APPS, AppId } from "@stackframe/stack-shared/dist/apps/apps-config";
import { notFound } from "next/navigation";
import AppDetailsPageClient from "./page-client";

export default async function AppDetailsPage({ params }: { params: Promise<{ appId: AppId }> }) {
  const appId = (await params).appId;
  if (!(appId in ALL_APPS)) {
    return notFound();
  }

  return (
    <AppDetailsPageClient appId={appId} />
  );
}
