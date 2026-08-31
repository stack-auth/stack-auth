import { globalPrismaClient, retryTransaction } from '@/prisma-client';
import { Prisma } from '@/generated/prisma/client';
import { decodeBase64OrBase64Url, toHexString } from '@hexclave/shared/dist/utils/bytes';
import { getEnvVariable } from '@hexclave/shared/dist/utils/env';
import { HexclaveAssertionError, captureError, throwErr } from '@hexclave/shared/dist/utils/errors';
import { sha512 } from '@hexclave/shared/dist/utils/hashes';
import { getPrivateJwks, getPublicJwkSet } from '@hexclave/shared/dist/utils/jwt';
import { PROJECT_OAUTH_PROVIDER_JWKS_PATH } from '@hexclave/shared/dist/utils/urls';
import { deindent } from '@hexclave/shared/dist/utils/strings';
import { generateUuid } from '@hexclave/shared/dist/utils/uuids';
import Provider, { Adapter, AdapterConstructor, AdapterPayload, Configuration, errors } from 'oidc-provider';

type AdapterData = {
  payload: AdapterPayload,
  expiresAt: Date,
};

function createAdapter(options: {
  onUpdateUnique: (
    model: string,
    idOrWhere: string | { propertyKey: keyof AdapterPayload, propertyValue: string },
    updater: (old: AdapterData | undefined) => AdapterData | undefined
  ) => Promise<AdapterData | undefined>,
  onFindMiss?: (model: string, id: string) => Promise<AdapterPayload | undefined>,
}): AdapterConstructor {
  const niceUpdate = async (
    model: string,
    idOrWhere: string | { propertyKey: keyof AdapterPayload, propertyValue: string },
    updater?: (old: AdapterData | undefined) => AdapterData | undefined,
  ): Promise<AdapterPayload | undefined> => {
    const updated = await options.onUpdateUnique(
      model,
      idOrWhere,
      updater ? updater : (old) => old,
    );
    return updated?.payload;
  };

  return class CustomAdapter implements Adapter {
    private model: string;

    constructor(model: string) {
      this.model = model;
      if (!model) {
        throw new HexclaveAssertionError(deindent`
          model must be non-empty.
          
          oidc-provider should never call the constructor with an empty string. However, it relies on 'constructor.name' in some locations, causing it to fail when class name minification is enabled. Make sure that server-side class names are not minified, for example by disabling serverMinification in next.config.mjs.
        `);
      }
    }

    async upsert(id: string, payload: AdapterPayload, expiresInSeconds: number | undefined): Promise<void> {
      // oidc-provider persists the artifacts of RFC 7591 dynamic client registration — the Client
      // itself and its RegistrationAccessToken — without an expiration (see `lib/models/client.js`
      // and `lib/models/base_model.js#save`). Our storage requires an expiry and the read path
      // filters on it, so cap those records at one year: long enough that clients won't notice in
      // practice (OAuth clients re-register when their client_id stops resolving), short enough
      // that the open, unauthenticated registration endpoint cannot grow the table without bound.
      // Every other model always gets an explicit expiration from oidc-provider, so anything else
      // missing one is a bug.
      if (expiresInSeconds === undefined) {
        if (this.model !== 'Client' && this.model !== 'RegistrationAccessToken') throw new HexclaveAssertionError(`expiresInSeconds of ${this.model}:${id} is undefined; oidc-provider only omits it for dynamic client registration models`, { model: this.model, id, payload });
        expiresInSeconds = 60 * 60 * 24 * 365;
      }
      // if one of these assertions is triggered, make sure you're not minifying class names (see the constructor)
      if (expiresInSeconds < 0) throw new HexclaveAssertionError(`expiresInSeconds of ${this.model}:${id} must be non-negative, got ${expiresInSeconds}`, { expiresInSeconds, model: this.model, id, payload });
      if (expiresInSeconds > 60 * 60 * 24 * 365 * 100) throw new HexclaveAssertionError(`expiresInSeconds of ${this.model}:${id} must be less than 100 years, got ${expiresInSeconds}`, { expiresInSeconds, model: this.model, id, payload });
      if (!Number.isFinite(expiresInSeconds)) throw new HexclaveAssertionError(`expiresInSeconds of ${this.model}:${id} must be a finite number, got ${expiresInSeconds}`, { expiresInSeconds, model: this.model, id, payload });

      await niceUpdate(this.model, id, () => ({ payload, expiresAt: new Date(Date.now() + expiresInSeconds * 1000) }));
    }

    async find(id: string): Promise<AdapterPayload | undefined> {
      const stored = await niceUpdate(this.model, id);
      if (stored) return stored;
      return await options.onFindMiss?.(this.model, id);
    }

    async findByUserCode(userCode: string): Promise<AdapterPayload | undefined> {
      return await niceUpdate(this.model, { propertyKey: 'userCode', propertyValue: userCode });
    }

    async findByUid(uid: string): Promise<AdapterPayload | undefined> {
      return await niceUpdate(this.model, { propertyKey: 'uid', propertyValue: uid });
    }

    async consume(id: string): Promise<void> {
      await niceUpdate(this.model, id, (old) => old ? { ...old, payload: { ...old.payload, consumed: true } } : undefined);
    }

    async destroy(id: string): Promise<void> {
      await niceUpdate(this.model, id, () => undefined);
    }

    async revokeByGrantId(grantId: string): Promise<void> {
      await niceUpdate(this.model, { propertyKey: 'grantId', propertyValue: grantId }, () => undefined);
    }
  };
}

function createPrismaAdapter(idpId: string, onFindMiss?: (model: string, id: string) => Promise<AdapterPayload | undefined>) {
  return createAdapter({
    onFindMiss,
    async onUpdateUnique(model, idOrWhere, updater) {
      return await retryTransaction(globalPrismaClient, async (tx) => {
        const oldAll = await tx.idPAdapterData.findMany({
          where: typeof idOrWhere === 'string' ? {
            idpId,
            model,
            id: idOrWhere,
            expiresAt: {
              gt: new Date(),
            },
          } : {
            idpId,
            model,
            payload: {
              path: [`${idOrWhere.propertyKey}`],
              equals: idOrWhere.propertyValue,
            },
            expiresAt: {
              gt: new Date(),
            },
          },
        });

        if (oldAll.length > 1) throwErr(`Multiple ${model} found with ${idOrWhere}; this shouldn't happen`);
        const old = oldAll.length === 0 ? undefined : oldAll[0];

        const updated = updater(old ? {
          payload: old.payload as AdapterPayload,
          expiresAt: old.expiresAt,
        } : undefined);

        if (updated) {
          if (old) {
            await tx.idPAdapterData.update({
              where: {
                idpId_model_id: {
                  idpId,
                  model,
                  id: old.id,
                },
              },
              data: {
                payload: updated.payload as any,
                expiresAt: updated.expiresAt,
              },
            });
          } else {
            await tx.idPAdapterData.create({
              data: {
                idpId,
                model,
                id: typeof idOrWhere === "string" ? idOrWhere : throwErr(`No ${model} found where ${JSON.stringify(idOrWhere)}`),
                payload: updated.payload as any,
                expiresAt: updated.expiresAt,
              },
            });
          }
        } else {
          if (old) {
            await tx.idPAdapterData.delete({
              where: {
                idpId_model_id: {
                  idpId,
                  model,
                  id: old.id,
                },
              },
            });
          }
        }

        return updated;
      });
    },
  });
}

export type OidcProviderOptions = {
  id: string,
  baseUrl: string,
  clients?: Configuration['clients'],
  clientDefaults?: Configuration['clientDefaults'],
  findClient?: (clientId: string) => Promise<AdapterPayload | undefined>,
  scopes?: string[],
  /** RFC 8707 `resource=` servers, keyed by resource URI. */
  resourceServers?: Map<string, { audience: string }>,
  findAccount?: Configuration['findAccount'],
  extraTokenClaims?: Configuration['extraTokenClaims'],
  features?: {
    /** RFC 7591. */
    registration?: boolean,
    /** RFC 7009. */
    revocation?: boolean,
  },
  requirePkce?: boolean,
  middleware?: (provider: Provider) => void,
  userFacingAuthorizationErrors?: boolean,
  jwksRoute?: string,
};

function wrapOidcMiddleware(oidc: Provider, mw: Parameters<typeof oidc.use>[0]): void {
  oidc.use((ctx, next) => {
    try {
      return mw(ctx, next);
    } catch (err) {
      captureError('idp-oidc-provider-middleware-error', err);
      throw err;
    }
  });
}

// NOTE: this `audience` string is an OPAQUE key-derivation salt mixed into the
// SHA-256 that produces the per-audience signing secret + kid in
// `getPrivateJwks` (see packages/shared/src/utils/jwt.tsx:114-115). It is
// never exposed to OIDC clients (the actual OIDC `aud` claim is set elsewhere).
// Changing this string rotates ALL outstanding JWT signing keys and invalidates
// every cached client JWKS — so it is intentionally pinned to the pre-rebrand
// domain (internal opaque identifier — never exposed to clients).
// Exported so the backend can verify an IdP's own tokens locally (without an HTTP
// round trip to its JWKS endpoint) — see verifyProjectOAuthAccessToken.
export function getIdpJwksKeyDerivationAudience(idpId: string): string {
  return `https://idp-jwk-audience.stack-auth.com/${encodeURIComponent(idpId)}`;
}

const NATIVE_CUSTOM_SCHEME_INVALIDATION_SUFFIX = "for native clients using Custom URI scheme should use reverse domain name based scheme";

/**
 * Lets native clients register custom-scheme redirect URIs that are not reverse-domain-named.
 *
 * oidc-provider enforces RFC 8252's SHOULD-level reverse-domain convention (`com.example.app:/...`)
 * as a hard registration error, but real MCP clients register plain product schemes
 * (`vscode://...`, `cursor://...`) and are rejected outright. Overriding
 * `Client.Schema.prototype.invalidate` is oidc-provider's own escape hatch for relaxing specific
 * metadata invalidations; the message-suffix match is pinned to oidc-provider 8.5.1's wording and
 * an e2e test registers a `cursor://` client so an upstream wording change fails tests, not users.
 *
 * The cast below: `provider.Client.Schema` is a real, stable runtime surface
 * (lib/models/client.js defines the static; the invalidate-override technique is how oidc-provider
 * docs suggest customizing validation) that `@types/oidc-provider` simply does not declare, so the
 * type system cannot express this. The expected shape is asserted at provider construction and
 * throws loudly on drift, so an oidc-provider upgrade that moves this API breaks at boot rather
 * than silently re-enabling the rejection.
 */
export function allowNonReverseDomainNativeRedirectSchemes(oidcProvider: Provider): void {
  const clientModel = (oidcProvider as unknown as { Client?: { Schema?: { prototype?: { invalidate?: unknown } } } }).Client;
  const schemaPrototype = clientModel?.Schema?.prototype;
  const originalInvalidate = schemaPrototype?.invalidate;
  if (schemaPrototype === undefined || typeof originalInvalidate !== "function") {
    throw new HexclaveAssertionError("oidc-provider no longer exposes Client.Schema.prototype.invalidate; the native custom-scheme redirect relaxation must be reimplemented for this oidc-provider version.");
  }
  schemaPrototype.invalidate = function (this: unknown, message: unknown, code: unknown) {
    if (typeof message === "string" && message.endsWith(NATIVE_CUSTOM_SCHEME_INVALIDATION_SUFFIX)) {
      return undefined;
    }
    return originalInvalidate.call(this, message, code);
  };
}

export async function createOidcProviderInternal(options: OidcProviderOptions) {
  const privateJwks = await getPrivateJwks({
    audience: getIdpJwksKeyDerivationAudience(options.id),
  });
  const privateJwkSet = {
    keys: privateJwks,
  };
  const publicJwkSet = await getPublicJwkSet(privateJwks);

  const findClient = options.findClient;
  const resourceServers = options.resourceServers;
  const adapter = createPrismaAdapter(
    options.id,
    findClient
      ? async (model, id) => model === 'Client' ? await findClient(id) : undefined
      : undefined,
  );

  const oidc = new Provider(options.baseUrl, {
    adapter,
    clients: options.clients ?? JSON.parse(getEnvVariable("STACK_INTEGRATION_CLIENTS_CONFIG", "[]")),
    ...(options.clientDefaults === undefined ? {} : { clientDefaults: options.clientDefaults }),
    cookies: {
      keys: [
        toHexString(await sha512(`oidc-idp-cookie-encryption-key:${getEnvVariable("STACK_SERVER_SECRET")}`)),
      ],
    },
    jwks: privateJwkSet,
    features: {
      devInteractions: {
        enabled: false,
      },
      registration: {
        enabled: options.features?.registration ?? false,
      },
      revocation: {
        enabled: options.features?.revocation ?? false,
      },
      resourceIndicators: resourceServers ? {
        enabled: true,
        // `@types/oidc-provider` types `defaultResource` as `string | string[]` even though the
        // runtime accepts `undefined` to mean "no default", so we omit the helper instead of returning undefined.
        ...resourceServers.size === 1 ? {
          defaultResource: async () => [...resourceServers.keys()][0],
        } : {},
        getResourceServerInfo: async (ctx, resourceIndicator, client) => {
          const resourceServer = resourceServers.get(resourceIndicator);
          if (!resourceServer) {
            throw new errors.InvalidTarget();
          }
          return {
            audience: resourceServer.audience,
            // Empty string is oidc-provider's "this resource server supports no scopes" sentinel.
            scope: "",
            accessTokenFormat: 'jwt' as const,
            // Unset `jwt.sign` makes oidc-provider default to RS256, which fails: this key set is ES256-only.
            jwt: {
              sign: {
                alg: privateJwkSet.keys[0]?.alg ?? throwErr("Project OAuth JWKS had no signing algorithm"),
                kid: privateJwkSet.keys[0]?.kid ?? throwErr("Project OAuth JWKS had no signing key ID"),
              },
            },
          };
        },
      } : { enabled: false },
    },
    scopes: options.scopes ?? [],
    ...(options.jwksRoute === undefined ? {} : { routes: { jwks: options.jwksRoute } }),
    responseTypes: [
      "code",
    ],
    ...options.requirePkce ? { pkce: { required: () => true } } : {},
    extraTokenClaims: options.extraTokenClaims,

    interactions: {
      url: (ctx, interaction) => `${options.baseUrl}/interaction/${encodeURIComponent(interaction.uid)}`,
    },

    async renderError(ctx, out, error) {
      if (!(error instanceof errors.OIDCProviderError) || error.statusCode >= 500) {
        captureError("idp-oidc-provider-render-error", error);
      }
      console.warn("IdP error occurred. This usually indicates a misconfigured client, not a server error.", { out });
      ctx.status = 400;
      const isAuthorizationNavigation = /^\/(?:auth(?:\/[^/]+)?|interaction\/[^/]+)$/.test(ctx.path);
      const acceptsHtml = ctx.accepts("html") === "html";
      if (options.userFacingAuthorizationErrors === true && isAuthorizationNavigation && acceptsHtml) {
        ctx.type = "text/html";
        ctx.body = `<!doctype html>
          <html lang="en">
            <head>
              <meta charset="utf-8">
              <meta name="viewport" content="width=device-width, initial-scale=1">
              <title>Authorization unavailable</title>
              <style>
                :root { color-scheme: light; font-family: ui-sans-serif, system-ui, sans-serif; }
                body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #fafafa; color: #18181b; }
                main { max-width: 32rem; margin: 1rem; padding: 2rem; border: 1px solid #e4e4e7; border-radius: 0.75rem; background: white; text-align: center; }
                h1 { margin: 0 0 0.75rem; font-size: 1.25rem; }
                p { margin: 0; color: #71717a; line-height: 1.5; }
              </style>
            </head>
            <body>
              <main>
              <h1>Authorization unavailable</h1>
              <p>This authorization request could not be completed. Return to the application that started sign-in and try again.</p>
              </main>
            </body>
          </html>`;
        return;
      }
      ctx.type = "application/json";
      ctx.body = JSON.stringify(out);
    },

    findAccount: options.findAccount ?? (async (ctx, sub, token) => {
      return {
        accountId: sub,
        async claims(use, scope, claims, rejected) {
          return { sub };
        },
      };
    }),
  });

  oidc.on('server_error', (ctx, err) => {
    captureError('idp-oidc-provider-server-error', err);
  });

  // Log all errors
  wrapOidcMiddleware(oidc, async (ctx, next) => {
    try {
      return await next();
    } catch (e) {
      console.warn("IdP threw an error. This most likely indicates a misconfigured client, not a server error.", e, { path: ctx.path, ctx });
      throw e;
    }
  });

  // .well-known/jwks.json
  wrapOidcMiddleware(oidc, async (ctx, next) => {
    if (ctx.path === PROJECT_OAUTH_PROVIDER_JWKS_PATH) {
      ctx.body = publicJwkSet;
      ctx.type = 'application/json';
      return;
    }
    await next();
  });

  options.middleware?.(oidc);

  return oidc;
}

export async function createOidcProvider(options: { id: string, baseUrl: string, clientInteractionUrl: string }) {
  return await createOidcProviderInternal({
    id: options.id,
    baseUrl: options.baseUrl,
    middleware: (oidc) => installIntegrationInteractionMiddleware(oidc, options),
  });
}

function installIntegrationInteractionMiddleware(
  oidc: Provider,
  options: { id: string, baseUrl: string, clientInteractionUrl: string },
) {
  // Interactions
  wrapOidcMiddleware(oidc, async (ctx, next) => {
    if (/^\/interaction\/[^/]+\/done$/.test(ctx.path)) {
      switch (ctx.method) {
        case 'GET': {
          // GETs need to be idempotent, but we want to allow people to redirect to a URL with a normal browser redirect
          // so provide this GET version of the endpoint that just redirects to the POST version
          ctx.status = 200;
          ctx.type = 'text/html';
          ctx.body = `
            <html>
              <head>
                <title>Redirecting... — Hexclave</title>
                <style id="gradient-style">
                  body {
                    color: white;
                    background-image: linear-gradient(45deg, #000, #444, #000, #444, #000, #444, #000);
                    background-size: 400% 400%;
                    background-repeat: no-repeat;
                    animation: celebrate-gradient 60s linear infinite;
                    min-height: 100vh;
                  }
                  @keyframes celebrate-gradient {
                    0% { background-position: 0% 100%; }
                    100% { background-position: 100% 0%; }
                  }
                </style>
              </head>
              <body>
                <form id="continue-form" method="POST">
                  If you are not redirected, please press the button below.<br>
                  <input type="submit" value="Continue">
                </form>
                <script>
                  document.getElementById('continue-form').style.visibility = 'hidden';
                  document.getElementById('continue-form').submit();
                  setTimeout(() => {
                    document.getElementById('gradient-style').remove();
                    document.getElementById('continue-form').style.visibility = 'visible';
                  }, 12000);
                </script>
              </body>
            </html>
          `;
          return;
        }
        case 'POST': {
          const authorizationCode = `${ctx.request.query.code}`;
          const authorizationCodeObj = await globalPrismaClient.projectWrapperCodes.findUnique({
            where: {
              idpId: options.id,
              authorizationCode,
            },
          });

          if (!authorizationCodeObj) {
            ctx.status = 400;
            ctx.type = "text/plain";
            ctx.body = "Invalid authorization code. Please try again.";
            return;
          }

          await globalPrismaClient.projectWrapperCodes.delete({
            where: {
              idpId_id: {
                idpId: authorizationCodeObj.idpId,
                id: authorizationCodeObj.id,
              },
            },
          });

          const interactionDetails = await oidc.interactionDetails(ctx.req, ctx.res);

          const uid = ctx.path.split('/')[2];
          if (uid !== authorizationCodeObj.interactionUid) {
            ctx.status = 400;
            ctx.type = "text/plain";
            ctx.body = "Different interaction UID than expected from the authorization code. Did you redirect to the correct URL?";
            return;
          }

          const account = await globalPrismaClient.idPAccountToCdfcResultMapping.create({
            data: {
              idpId: authorizationCodeObj.idpId,
              id: authorizationCodeObj.id,
              idpAccountId: generateUuid(),
              cdfcResult: authorizationCodeObj.cdfcResult ?? Prisma.JsonNull,
            },
          });

          const grant = new oidc.Grant({
            accountId: account.idpAccountId,
            clientId: interactionDetails.params.client_id as string,
          });
          grant.addOIDCScope('openid profile');

          const grantId = await grant.save(60 * 60 * 24);

          const result = {
            login: {
              accountId: account.idpAccountId,
            },
            consent: {
              grantId,
            },
          };

          return await oidc.interactionFinished(ctx.req, ctx.res, result);
        }
      }
    } else if (ctx.method === 'GET' && /^\/interaction\/[^/]+$/.test(ctx.path)) {
      const details = await oidc.interactionDetails(ctx.req, ctx.res);

      const state = details.params.state || "";
      if (typeof state !== 'string') {
        throwErr(`state is not a string`);
      }
      let externalProjectName: string | undefined;
      try {
        const base64Decoded = new TextDecoder().decode(decodeBase64OrBase64Url(state));
        const json = JSON.parse(base64Decoded);
        externalProjectName = json?.details?.external_project_name ?? json?.details?.neon_project_name;
        if (typeof externalProjectName !== 'string') {
          throwErr(`external_project_name is not a string`, { type: typeof externalProjectName, externalProjectName });
        }
      } catch (e) {
        // this probably shouldn't happen, because it means Neon messed up the configuration
        // (or maybe someone is playing with the API, but in that case it's not a bad idea to notify us either)
        // either way, let's capture an error and continue without the display name
        captureError('idp-oidc-provider-interaction-state-decode-error', e);
      }

      const uid = ctx.path.split('/')[2];
      const interactionUrl = new URL(options.clientInteractionUrl);
      interactionUrl.searchParams.set("interaction_uid", uid);
      if (externalProjectName) {
        interactionUrl.searchParams.set("external_project_name", externalProjectName);
      }
      return ctx.redirect(interactionUrl.toString());
    }
    await next();
  });
}
