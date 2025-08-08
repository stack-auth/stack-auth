import { devFeaturesEnabledForProject } from "@/lib/utils";
import PageClient from "./page-client";
import { notFound } from "next/navigation";

export const metadata = {
  title: "Payments",
};

type Params = {
  projectId: string,
};

export default async function Page({ params }: { params: Promise<Params> }) {
  const { projectId } = await params;
  if (!devFeaturesEnabledForProject(projectId)) {
    notFound();
  }
  return (
    <PageClient />
  );
}
