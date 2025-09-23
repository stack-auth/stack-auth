const localApiUrl = "http://localhost:8102";
const apiUrl = "https://davis-tourism-calculators-hop.trycloudflare.com";
const projectId = "internal";

export default {
  providers: [
    {
      type: "customJwt",
      issuer: `${localApiUrl}/api/v1/projects/${projectId}`,
      jwks: `${apiUrl}/api/v1/projects/${projectId}/.well-known/jwks.json?include_anonymous=true`,
      algorithm: "ES256",
    },
  ]
}
