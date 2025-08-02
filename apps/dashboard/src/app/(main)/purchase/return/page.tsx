type Props = {
  searchParams: Promise<{ redirect_status: string }>,
};

export default async function Page({ searchParams }: Props) {
  const { redirect_status } = await searchParams;
  if (redirect_status === "failed") {
    return (
      <div className="flex flex-col items-center justify-center h-screen">
        <h1 className="text-2xl font-bold">Purchase failed</h1>
        <p className="text-sm text-gray-500">
          There was an error processing your purchase
        </p>
      </div>
    );
  }
  return (
    <div className="flex flex-col items-center justify-center h-screen">
      <h1 className="text-2xl font-bold">Purchase successful</h1>
      <p className="text-sm text-gray-500">
        You can now close this page
      </p>
    </div>
  );
}
