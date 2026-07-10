import { redirect } from "next/navigation";

export default async function Page(props: { params: Promise<{ projectId: string }> }) {
  const params = await props.params;
  redirect(`/projects/${encodeURIComponent(params.projectId)}/continuum`);
}
