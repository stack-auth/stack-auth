import { AdminAppProvider } from "../use-admin-app";
import PageClient from "./page-client";

export default function Page({ params }: { params: { projectId: string } }) {
  return (
    <AdminAppProvider projectId={params.projectId}>
      <PageClient />
    </AdminAppProvider>
  );
}
