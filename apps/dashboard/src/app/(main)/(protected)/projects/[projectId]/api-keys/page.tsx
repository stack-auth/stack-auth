// This page used to be the location of Project Keys before it was moved to /project-keys
// Redirecting to the new location
import { redirect } from 'next/navigation';

export default function Page({
  params,
}: {
  params: { projectId: string },
}) {
  redirect(`/projects/${params.projectId}/project-keys`);
}
