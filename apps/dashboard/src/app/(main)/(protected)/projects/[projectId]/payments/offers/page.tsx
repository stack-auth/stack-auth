import { devFeaturesEnabledForProject } from "@/lib/utils";
import { notFound } from "next/navigation";
import PageClient from "./page-client";

export const metadata = {
  title: "Offers",
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


