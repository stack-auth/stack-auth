import { AppId } from "@stackframe/stack-shared/dist/apps/apps-config";
import AppDetailsPageClient from "./page-client";

export default async function AppDetailsPage({ params }: { params: Promise<{ appId: AppId }> }) {
  const appId = (await params).appId;

  return (
    <AppDetailsPageClient appId={appId} />
  );
}
