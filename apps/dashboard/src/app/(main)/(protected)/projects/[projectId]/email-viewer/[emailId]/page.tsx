import PageClient from "./page-client";

export const metadata = {
  title: "Email Details",
};

export default async function Page({
  params,
}: {
  params: Promise<{ emailId: string }>,
}) {
  const awaitedParams = await params;
  return (
    <PageClient emailId={awaitedParams.emailId} />
  );
}
