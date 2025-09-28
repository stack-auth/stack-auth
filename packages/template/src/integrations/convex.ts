import { urlString } from "@stackframe/stack-shared/dist/utils/urls";
import { getDefaultProjectId } from "../lib/stack-app/apps/implementations/common";

export function getConvexProvidersConfig(options: {
  projectId?: string,
}) {
  const projectId = options.projectId ?? getDefaultProjectId();
  return [
    {
      type: "customJwt",
      issuer: urlString`https://api.stack-auth.com/api/v1/projects/${projectId}`,
      jwks: urlString`https://api.stack-auth.com/api/v1/projects/${projectId}/.well-known/jwks.json?include_anonymous=true`,
      algorithm: "ES256",
    },
  ];
}
