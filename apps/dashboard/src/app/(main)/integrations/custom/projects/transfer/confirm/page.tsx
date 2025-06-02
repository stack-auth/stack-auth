import IntegrationProjectTransferConfirmPageClient from "@/app/(main)/integrations/transfer-confirm-page";

export const metadata = {
  title: "Project transfer",
};

export default async function Page(props: { searchParams: Promise<{ code?: string }> }) {
  const transferCode = (await props.searchParams).code;
  if (!transferCode) {
    return <>
      <div>Error: No transfer code provided.</div>
    </>;
  }

  return (
    <>
      <IntegrationProjectTransferConfirmPageClient type="custom" />
    </>
  );
}
