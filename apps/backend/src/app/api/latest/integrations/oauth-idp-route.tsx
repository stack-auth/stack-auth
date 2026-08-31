import { handleApiRequest } from "@/route-handlers/smart-route-handler";
import { getEnvVariable } from "@hexclave/shared/dist/utils/env";
import { HexclaveAssertionError } from "@hexclave/shared/dist/utils/errors";
import { dispatchToNodeHttpHandler } from "@hexclave/shared/dist/utils/node-http";
import { createOidcProvider } from "./idp";

function isNotOidcSessionCookie(name: string, value: string): boolean {
  return name !== "set-cookie" || !value.match(/^_session\.?/);
}

export function createIntegrationIdpHandler(integration: "neon" | "custom") {
  const pathPrefix = `/api/v1/integrations/${integration}/oauth/idp`;

  // we want to initialize the OIDC provider lazily so it's not initiated at build time
  let oidcCallbackPromiseCache: Promise<ReturnType<Awaited<ReturnType<typeof createOidcProvider>>["callback"]>> | undefined;
  function getOidcCallbackPromise() {
    if (!oidcCallbackPromiseCache) {
      const apiBaseUrl = new URL(getEnvVariable("NEXT_PUBLIC_STACK_API_URL"));
      const idpBaseUrl = new URL(pathPrefix, apiBaseUrl);
      oidcCallbackPromiseCache = (async () => {
        const oidc = await createOidcProvider({
          id: `stack-preconfigured-idp:integrations/${integration}`,
          baseUrl: idpBaseUrl.toString(),
          clientInteractionUrl: new URL(`/integrations/${integration}/confirm`, getEnvVariable("NEXT_PUBLIC_STACK_DASHBOARD_URL")).toString(),
        });
        return oidc.callback();
      })();
    }
    return oidcCallbackPromiseCache;
  }

  return handleApiRequest(async (req: Request) => {
    const newUrl = req.url.replace(pathPrefix, "");
    if (newUrl === req.url) {
      throw new HexclaveAssertionError("No path prefix found in request URL. Is the pathPrefix correct?", { newUrl, url: req.url, pathPrefix });
    }
    return await dispatchToNodeHttpHandler(await getOidcCallbackPromise(), {
      method: req.method,
      originalUrl: new URL(req.url),
      url: new URL(newUrl),
      headers: new Headers(req.headers),
      body: new Uint8Array(await req.arrayBuffer()),
      filterResponseHeader: isNotOidcSessionCookie,
    });
  });
}
