import { urlString } from "@stackframe/stack-shared/dist/utils/urls";
import { defaultBaseUrl } from "../lib/stack-app/apps/implementations/common";

export function getConvexProvidersConfig(options: {
  baseUrl?: string,
  projectId: string,
}) {
  const baseUrl = options.baseUrl || defaultBaseUrl;
  const projectId = options.projectId;
  return [
    {
      type: "customJwt",
      issuer: new URL(urlString`/api/v1/projects/${projectId}`, baseUrl),
      jwks: new URL(urlString`/api/v1/projects/${projectId}/.well-known/jwks.json`, baseUrl),
      algorithm: "ES256",
    },
    {
      type: "customJwt",
      issuer: new URL(urlString`/api/v1/projects-anonymous-users/${projectId}`, baseUrl),
      jwks: new URL(urlString`/api/v1/projects/${projectId}/.well-known/jwks.json?include_anonymous=true`, baseUrl),
      algorithm: "ES256",
    },
  ];
}
