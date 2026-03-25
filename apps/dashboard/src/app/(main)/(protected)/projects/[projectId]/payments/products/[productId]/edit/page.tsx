import PageClient from "./page-client";

export const metadata = {
  title: "Edit Product",
};

export default async function Page({
  params,
}: {
  params: Promise<{ productId: string }>,
}) {
  const awaitedParams = await params;
  return (
    <PageClient productId={awaitedParams.productId} />
  );
}
