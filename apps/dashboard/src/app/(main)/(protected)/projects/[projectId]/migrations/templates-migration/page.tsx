import { PageClient } from "./page-client";
import { notFound } from "next/navigation";

export default async function TemplatesMigrationPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  if (projectId !== "internal") {
    notFound();
  }

  return <PageClient />;
}
