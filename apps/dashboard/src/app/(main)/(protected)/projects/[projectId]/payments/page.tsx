import { devFeaturesEnabledForProject } from "@/lib/utils";
import PageClient from "./page-client";
import { notFound } from "next/navigation";

export const metadata = {
  title: "Payments",
};

type Params = {
  projectId: string,
};

export default function Page({ params }: { params: Params }) {
  if (!devFeaturesEnabledForProject(params.projectId)) {
    notFound();
  }
  return (
    <PageClient />
  );
}
