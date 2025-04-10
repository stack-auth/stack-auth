import PageClient from "./page-client";

export const metadata = {
  title: "Webhook Endpoint",
};

export default async function Page(props: { params: Promise<{ endpointId: string }> }) {
  const params = await props.params;
  return (
    <PageClient endpointId={params.endpointId} />
  );
}
