import { AppId } from "@stackframe/stack-shared/dist/apps/apps-config";
import AppDetailsModalPageClient from "./page-client";

export default async function AppDetailsModalPage({ params }: { params: Promise<{ appId: AppId }> }) {
  const appId = (await params).appId;

  return (
    <AppDetailsModalPageClient appId={appId} />
  );
}
