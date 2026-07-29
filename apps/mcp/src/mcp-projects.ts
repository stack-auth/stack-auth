export type McpProjectSummary = {
  id: string,
  display_name: string | null,
  description: string | null,
};

export function assertManagedProject(projects: readonly McpProjectSummary[], projectId: string): void {
  if (!projects.some(project => project.id === projectId)) {
    throw new Error("The authenticated user does not manage the requested project.");
  }
}
