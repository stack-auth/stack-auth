import { ALL_APPS, AppId } from "@stackframe/stack-shared/dist/apps/apps-config";
import { notFound } from "next/navigation";
import AppDetailsModalPageClient from "./page-client";

export default async function AppDetailsModalPage({ params }: { params: Promise<{ appId: AppId }> }) {
  const appId = (await params).appId;
  if (!(appId in ALL_APPS)) {
    return notFound();
  }

  return (
    <AppDetailsModalPageClient appId={appId} />
  );
}
