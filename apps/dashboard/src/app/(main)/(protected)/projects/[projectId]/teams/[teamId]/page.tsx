import PageClient from "./page-client";

export const metadata = {
  title: "Team Members",
};

export default async function Page(props: { params: Promise<{ teamId: string }> }) {
  const params = await props.params;
  return (
    <PageClient teamId={params.teamId} />
  );
}
