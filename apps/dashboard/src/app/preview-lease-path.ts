export function getPreviewTargetPath(pathname: string, projectId: string): string {
  const encodedProjectId = encodeURIComponent(projectId);
  if (pathname === "/projects" || pathname === "/projects/") {
    return `/projects/${encodedProjectId}`;
  }

  if (pathname === "/projects/-selector-") {
    return `/projects/${encodedProjectId}`;
  }

  if (pathname.startsWith("/projects/-selector-/")) {
    return `/projects/${encodedProjectId}${pathname.slice("/projects/-selector-".length)}`;
  }

  const projectRouteMatch = pathname.match(/^\/projects\/[^/]+/);
  if (projectRouteMatch != null) {
    return `/projects/${encodedProjectId}${pathname.slice(projectRouteMatch[0].length)}`;
  }

  return pathname;
}
