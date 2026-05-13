import CustomIntegrationProjectTransferConfirmPageClient from "@/app/(main)/integrations/transfer-confirm-page";

export const metadata = {
  title: "Project transfer",
};

function MissingCodeView() {
  return (
    <div className="flex min-h-[100dvh] w-full items-center justify-center px-4 py-8 sm:px-6">
      <div
        role="alert"
        className="relative flex w-full max-w-md items-start gap-3 rounded-2xl border border-red-500/30 bg-red-500/[0.06] p-4 text-sm"
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 256 256"
          className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-500"
          fill="currentColor"
        >
          <path d="M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm37.66,130.34a8,8,0,0,1-11.32,11.32L128,139.31l-26.34,26.35a8,8,0,0,1-11.32-11.32L116.69,128,90.34,101.66a8,8,0,0,1,11.32-11.32L128,116.69l26.34-26.35a8,8,0,0,1,11.32,11.32L139.31,128Z" />
        </svg>
        <div className="min-w-0">
          <h5 className="mb-1 font-medium leading-none tracking-tight text-red-600 dark:text-red-400">
            This transfer link is incomplete
          </h5>
          <p className="text-sm leading-relaxed text-foreground/80 dark:text-muted-foreground">
            Open the full link you received (it includes a transfer code). If the link expired, go back to the partner or integrations screen and start the transfer again.
          </p>
        </div>
      </div>
    </div>
  );
}

export default async function Page(props: { searchParams: Promise<{ code?: string }> }) {
  const transferCode = (await props.searchParams).code;
  if (!transferCode) {
    return <MissingCodeView />;
  }

  return <CustomIntegrationProjectTransferConfirmPageClient />;
}
