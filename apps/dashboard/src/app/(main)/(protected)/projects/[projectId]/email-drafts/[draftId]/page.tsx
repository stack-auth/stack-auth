import PageClient from "./page-client";

export const metadata = {
  title: "Email Draft",
};

export default async function Page(props: { params: Promise<{ draftId: string }> }) {
  const params = await props.params;
  return <PageClient draftId={params.draftId} />;
}

