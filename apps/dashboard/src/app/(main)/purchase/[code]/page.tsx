import PageClient from "./page-client";

export const metadata = {
  title: "Purchase",
};

export default async function Page({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return (
    <PageClient code={code} />
  );
}
