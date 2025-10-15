import { ProjectSelectorPageClient } from "./page-client";

export default async function ProjectSelectorPage(
  props: { params: Promise<{ path?: string[] }> }
) {
  const params = await props.params;
  const path = params.path?.join("/") || "";

  return <ProjectSelectorPageClient deepPath={path} />;
}
