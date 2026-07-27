import { globalPrismaClient, retryTransaction } from '@/prisma-client';
import { Prisma } from '@/generated/prisma/client';
import { decodeBase64OrBase64Url, toHexString } from '@hexclave/shared/dist/utils/bytes';
import { getEnvVariable } from '@hexclave/shared/dist/utils/env';
import { HexclaveAssertionError, captureError, throwErr } from '@hexclave/shared/dist/utils/errors';
import { sha512 } from '@hexclave/shared/dist/utils/hashes';
import { getPrivateJwks, getPublicJwkSet } from '@hexclave/shared/dist/utils/jwt';
import { deindent } from '@hexclave/shared/dist/utils/strings';
import { generateUuid } from '@hexclave/shared/dist/utils/uuids';
import Provider, { Adapter, AdapterConstructor, AdapterPayload, Configuration } from 'oidc-provider';

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
  /**
   * Consulted when `find` misses in storage. This is how clients that were never persisted —
   * resolved live from a client ID metadata document — become visible to the provider.
   *
   * Deliberately routed through the adapter rather than a separate lookup: `oidc-provider` funnels
   * every client resolution through `adapter('Client').find(id)`, so anything resolved here is
   * indistinguishable from a stored client to the rest of the provider. A second code path would
   * be a second place for the two to disagree about what a client may do.
   */
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

    async upsert(id: string, payload: AdapterPayload, expiresInSeconds: number): Promise<void> {
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

/**
 * The parts of an OIDC provider that differ between the two things we run one for:
 *
 *  - the **integration IdPs** (Neon, custom) — singletons with a static, env-configured client list,
 *    no scopes, and an interaction flow that trades a Hexclave-issued wrapper code for an account;
 *  - a **customer project acting as its own OAuth provider** — one per tenancy, with clients from
 *    config (or self-registered), a scope vocabulary projected from the project's RBAC, and
 *    resource servers for RFC 8707 audience binding.
 *
 * Everything else — the Prisma adapter, the per-instance JWKS derivation, cookie keys, error
 * rendering, the JWKS endpoint — is identical, which is why it lives in one factory.
 */
export type OidcProviderOptions = {
  /**
   * Identifies this provider instance. Used as the `idpId` partition key in `IdPAdapterData` and as
   * the salt for this instance's signing keys, so it must be stable forever and unique across all
   * providers we run. Integration IdPs use a fixed string; project providers use
   * `project:<projectId>:<branchId>`.
   */
  id: string,
  baseUrl: string,
  /** Statically known clients. Project providers pass their config-declared ones. */
  clients?: Configuration['clients'],
  /**
   * Looked up when a `client_id` isn't in `clients` — dynamic client registration and client ID
   * metadata documents both land here. Returning `undefined` makes it an unknown client.
   */
  findClient?: (clientId: string) => Promise<AdapterPayload | undefined>,
  /** The scope vocabulary this provider advertises and accepts. */
  scopes?: string[],
  /**
   * Resource servers for RFC 8707 `resource=`. Maps a resource URI to its audience and the scopes
   * valid there. MCP servers are resource servers.
   */
  resourceServers?: Map<string, { audience: string, scopes: string[] }>,
  /** Resolves the subject to an account and its claims. Defaults to an opaque `sub`-only account. */
  findAccount?: Configuration['findAccount'],
  /** Extra claims to stamp into issued access tokens (e.g. the granted scope list). */
  extraTokenClaims?: Configuration['extraTokenClaims'],
  features?: {
    /** RFC 7591 dynamic client registration. */
    registration?: boolean,
    /** RFC 7009 token revocation. Required for a usable "disconnect this app" button. */
    revocation?: boolean,
  },
  /**
   * Require PKCE on every authorization request. Mandatory under OAuth 2.1 and the MCP spec, but
   * off by default here so the pre-existing integration IdPs keep behaving exactly as they did.
   */
  requirePkce?: boolean,
  /** Installed after the built-in middleware. Where integration-specific interaction flows go. */
  middleware?: (provider: Provider) => void,
  /** Where to send the user to log in / consent. */
  interactionUrl?: (interactionUid: string) => string,
};

export async function createOidcProviderInternal(options: OidcProviderOptions) {
  // NOTE: this `audience` string is an OPAQUE key-derivation salt mixed into the
  // SHA-256 that produces the per-audience signing secret + kid in
  // `getPrivateJwks` (see packages/shared/src/utils/jwt.tsx:114-115). It is
  // never exposed to OIDC clients (the actual OIDC `aud` claim is set elsewhere).
  // Changing this string rotates ALL outstanding JWT signing keys and invalidates
  // every cached client JWKS — so it is intentionally pinned to the pre-rebrand
  // domain (internal opaque identifier — never exposed to clients).
  const privateJwks = await getPrivateJwks({
    audience: `https://idp-jwk-audience.stack-auth.com/${encodeURIComponent(options.id)}`,
  });
  const privateJwkSet = {
    keys: privateJwks,
  };
  const publicJwkSet = await getPublicJwkSet(privateJwks);

  const adapter = createPrismaAdapter(
    options.id,
    options.findClient
      // Only the `Client` model gets a fallback. Every other model (codes, grants, sessions) is
      // storage-backed by definition, and a miss there means the thing genuinely doesn't exist.
      ? async (model, id) => model === 'Client' ? await options.findClient!(id) : undefined
      : undefined,
  );

  const oidc = new Provider(options.baseUrl, {
    adapter,
    clients: options.clients ?? JSON.parse(getEnvVariable("STACK_INTEGRATION_CLIENTS_CONFIG", "[]")),
    ttl: {},
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
      resourceIndicators: options.resourceServers ? {
        enabled: true,
        // Which resource a token is for, when the client didn't pass `resource=`.
        //
        // We only supply a default when the project has exactly one resource server, where there is
        // no ambiguity — that is the DX win for the common "I have one MCP server" case. With zero
        // or several we omit the helper entirely and let oidc-provider's own default apply, which
        // resolves nothing and fails the request. Silently picking one of several would mint a token
        // for a resource server the client never named, i.e. exactly the confused-deputy problem
        // RFC 8707 exists to prevent.
        //
        // (Omitting rather than returning `undefined` is also what keeps this type-safe: the
        // published `@types/oidc-provider` types declare the return as `string | string[]` even
        // though the runtime accepts `undefined` to mean "no default".)
        ...options.resourceServers.size === 1 ? {
          defaultResource: async () => [...options.resourceServers!.keys()][0],
        } : {},
        getResourceServerInfo: async (ctx, resourceIndicator, client) => {
          const resourceServer = options.resourceServers!.get(resourceIndicator);
          if (!resourceServer) {
            // oidc-provider validates the indicator against `defaultResource`/the request before
            // reaching us, so an unknown one here means our map and the provider disagree.
            throw new HexclaveAssertionError(`Unknown resource indicator ${JSON.stringify(resourceIndicator)}.`, { resourceIndicator });
          }
          return {
            // The audience is what binds the token to this resource server, and — because
            // `getPrivateJwks` derives keys per audience — what makes it cryptographically unusable
            // anywhere else. See `getResourceAudience` in `lib/tokens.tsx`.
            audience: resourceServer.audience,
            scope: resourceServer.scopes.join(" "),
            accessTokenFormat: 'jwt' as const,
          };
        },
      } : { enabled: false },
    },
    scopes: options.scopes ?? [],
    responseTypes: [
      "code",
    ],
    // OAuth 2.1 and the MCP authorization spec both require PKCE unconditionally, so project
    // providers turn this on. It is NOT on by default: the Neon/custom integration IdPs predate
    // this factory being generalized, and forcing PKCE on them would break already-shipped clients.
    ...options.requirePkce ? { pkce: { required: () => true } } : {},
    extraTokenClaims: options.extraTokenClaims,

    interactions: {
      url: (ctx, interaction) => options.interactionUrl
        ? options.interactionUrl(interaction.uid)
        : `${options.baseUrl}/interaction/${encodeURIComponent(interaction.uid)}`,
    },

    async renderError(ctx, out, error) {
      console.warn("IdP error occurred. This usually indicates a misconfigured client, not a server error.", error, { out });
      ctx.status = 400;
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

  function middleware(mw: Parameters<typeof oidc.use>[0]) {
    oidc.use((ctx, next) => {
      try {
        return mw(ctx, next);
      } catch (err) {
        captureError('idp-oidc-provider-middleware-error', err);
        throw err;
      }
    });
  }

  // Log all errors
  middleware(async (ctx, next) => {
    try {
      return await next();
    } catch (e) {
      console.warn("IdP threw an error. This most likely indicates a misconfigured client, not a server error.", e, { path: ctx.path, ctx });
      throw e;
    }
  });

  // .well-known/jwks.json
  middleware(async (ctx, next) => {
    if (ctx.path === '/.well-known/jwks.json') {
      ctx.body = publicJwkSet;
      ctx.type = 'application/json';
      return;
    }
    await next();
  });

  options.middleware?.(oidc);

  return oidc;
}

/**
 * The integration IdP (Neon, custom) — a singleton provider whose login flow is driven by a
 * Hexclave-issued wrapper code rather than by a user session.
 *
 * Kept as its own function so that generalizing the factory above didn't change any behaviour for
 * the two integrations that already depend on it.
 */
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
  function middleware(mw: Parameters<typeof oidc.use>[0]) {
    oidc.use((ctx, next) => {
      try {
        return mw(ctx, next);
      } catch (err) {
        captureError('idp-oidc-provider-middleware-error', err);
        throw err;
      }
    });
  }

  // Interactions
  middleware(async (ctx, next) => {
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

