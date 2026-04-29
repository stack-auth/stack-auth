import PageClient from "../page-client";

export default async function Page(props: {
  params: Promise<{
    replayId: string,
  }>,
}) {
  const params = await props.params;
  return <PageClient initialReplayId={params.replayId} />;
}
