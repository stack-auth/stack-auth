// This page used to be the location of Project Keys before it was moved to /project-keys
// Redirecting to the new location
import { redirect } from 'next/navigation';

export default async function Page({
  params,
}: {
  params: Promise<{ projectId: string }>,
}) {
  const { projectId } = await params;
  redirect(`/projects/${projectId}/project-keys`);
}
