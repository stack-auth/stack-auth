import { getDefaultProjectId } from "../lib/stack-app/apps/implementations/common";

export function getConvexProvidersConfig(options: {
  projectId?: string,
}) {
  const projectId = options.projectId ?? getDefaultProjectId();
  return [
    {
      type: "customJwt",
      issuer: `https://api.stack-auth.com/api/v1/projects/${projectId}`,
      jwks: `https://api.stack-auth.com/api/v1/projects/${projectId}/.well-known/jwks.json?include_anonymous=true`,
      algorithm: "ES256",
    },
  ];
}
