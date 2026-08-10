type ProjectClientApp = {
  projectId: string,
  getAccessToken: () => Promise<string | null>,
};

export async function getProjectClientRequestHeaders(app: ProjectClientApp): Promise<Record<string, string>> {
  const token = await app.getAccessToken();
  if (token == null) throw new Error("Your session expired. Please sign in again.");
  return {
    "x-stack-access-type": "client",
    "x-stack-project-id": app.projectId,
    "x-stack-access-token": token,
  };
}
