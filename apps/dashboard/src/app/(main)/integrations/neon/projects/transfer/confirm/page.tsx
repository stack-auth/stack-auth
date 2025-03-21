import NeonIntegrationProjectTransferConfirmPageClient from "./page-client";

export const metadata = {
  title: "Project transfer",
};

export default async function NeonIntegrationProjectTransferConfirmPage(props: { searchParams: Promise<{ code?: string }> }) {
  const transferCode = (await props.searchParams).code;
  if (!transferCode) {
    return <>
      <div>Error: No transfer code provided.</div>
    </>;
  }

  return (
    <>
      <NeonIntegrationProjectTransferConfirmPageClient />
    </>
  );
}
