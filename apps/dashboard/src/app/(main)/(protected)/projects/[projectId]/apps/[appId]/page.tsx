import { ALL_APPS, AppId } from "@stackframe/stack-shared/dist/apps/apps-config";
import AppDetailsPageClient from "./page-client";

export const generateStaticParams = async () => {
  return Object.keys(ALL_APPS).map(appId => ({ appId }));
};

export const dynamicParams = false;

export default async function AppDetailsPage({ params }: { params: Promise<{ appId: AppId }> }) {
  const appId = (await params).appId;

  return (
    <AppDetailsPageClient appId={appId} />
  );
}
