import "../polyfills";

import { getUser, getUserQuery } from "@/app/api/latest/users/crud";
import { checkApiKeySet, checkApiKeySetQuery } from "@/lib/api-keys";
import { getProjectQuery, listManagedProjectIds } from "@/lib/projects";
import { Tenancy, getSoleTenancyFromProject } from "@/lib/tenancies";
import { decodeAccessToken } from "@/lib/tokens";
import { rawQueryAll } from "@/prisma-client";
import { traceSpan, withTraceSpan } from "@/utils/telemetry";
import { KnownErrors } from "@stackframe/stack-shared";
import { ProjectsCrud } from "@stackframe/stack-shared/dist/interface/crud/projects";
import { UsersCrud } from "@stackframe/stack-shared/dist/interface/crud/users";
import { StackAdaptSentinel, yupValidate } from "@stackframe/stack-shared/dist/schema-fields";
import { groupBy, typedIncludes } from "@stackframe/stack-shared/dist/utils/arrays";
import { getNodeEnvironment } from "@stackframe/stack-shared/dist/utils/env";
import { StackAssertionError, StatusError, captureError, throwErr } from "@stackframe/stack-shared/dist/utils/errors";
import { deindent } from "@stackframe/stack-shared/dist/utils/strings";
import { NextRequest } from "next/server";
import * as yup from "yup";

const allowedMethods = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"] as const;

export type SmartRequestAuth = {
  project: ProjectsCrud["Admin"]["Read"],
  branchId: string,
  tenancy: Tenancy,
  user?: UsersCrud["Admin"]["Read"] | undefined,
  type: "client" | "server" | "admin",
  refreshTokenId?: string,
};

export type DeepPartialSmartRequestWithSentinel<T = SmartRequest> = (T extends object ? {
  [P in keyof T]?: DeepPartialSmartRequestWithSentinel<T[P]>
} : T) | StackAdaptSentinel;

export type SmartRequest = {
  auth: SmartRequestAuth | null,
  url: string,
  method: typeof allowedMethods[number],
  body: unknown,
  headers: Record<string, string[] | undefined>,
  query: Record<string, string | undefined>,
  params: Record<string, string | undefined>,
  clientVersion: {
    platform: string,
    sdk: string,
    version: string,
  } | undefined,
};

export type MergeSmartRequest<T, MSQ = SmartRequest> =
  StackAdaptSentinel extends T
  ? NonNullable<MSQ> | (MSQ & Exclude<T, StackAdaptSentinel>)
  : (
    T extends (infer U)[]
    ? (
      MSQ extends (infer V)[]
      ? (T & MSQ) & { [K in keyof T & keyof MSQ]: MergeSmartRequest<T[K], MSQ[K]> }
      : (T & MSQ)
    )
    : (
      T extends object
      ? (
        MSQ extends object
        ? { [K in keyof T & keyof MSQ]: MergeSmartRequest<T[K], MSQ[K]> }
        : (T & MSQ)
      )
      : (T & MSQ)
    )
  );

async function validate<T>(obj: SmartRequest, schema: yup.Schema<T>, req: NextRequest | null): Promise<T> {
  try {
    return await yupValidate(schema, obj, {
      abortEarly: false,
      context: {
        noUnknownPathPrefixes: ["body", "query", "params"],
      },
      currentUserId: obj.auth?.user?.id ?? null,
    });
  } catch (error) {
    if (error instanceof yup.ValidationError) {
      if (req === null) {
        // we weren't called by a HTTP request, so it must be a logical error in a manual invocation
        throw new StackAssertionError("Request validation failed", { cause: error });
      } else {
        const inners = error.inner.length ? error.inner : [error];
        const description = schema.describe();

        for (const inner of inners) {
          if (inner.path === "auth" && inner.type === "nullable" && inner.value === null) {
            throw new KnownErrors.AccessTypeRequired;
          }
          if (inner.path === "auth.type" && inner.type === "oneOf") {
            // Project access type not sufficient
            const authTypeField = ((description as yup.SchemaObjectDescription).fields["auth"] as yup.SchemaObjectDescription).fields["type"] as yup.SchemaDescription;
            throw new KnownErrors.InsufficientAccessType(inner.value, authTypeField.oneOf as any[]);
          }
        }

        throw new KnownErrors.SchemaError(
          deindent`
            Request validation failed on ${req.method} ${req.nextUrl.pathname}:
              ${inners.map(e => deindent`
                - ${e.message}
              `).join("\n")}
          `,
        );
      }
    }
    throw error;
  }
}


async function parseBody(req: NextRequest, bodyBuffer: ArrayBuffer): Promise<SmartRequest["body"]> {
  const contentType = req.method === "GET" ? undefined : req.headers.get("content-type")?.split(";")[0];

  const getText = () => {
    try {
      return new TextDecoder().decode(bodyBuffer);
    } catch (e) {
      throw new KnownErrors.BodyParsingError("Request body cannot be parsed as UTF-8");
    }
  };

  switch (contentType) {
    case "":
    case undefined: {
      return undefined;
    }
    case "application/json": {
      const text = getText();
      try {
        return JSON.parse(text);
      } catch (e) {
        throw new KnownErrors.BodyParsingError("Invalid JSON in request body");
      }
    }
    case "application/octet-stream": {
      return bodyBuffer;
    }
    case "text/plain": {
      return getText();
    }
    case "application/x-www-form-urlencoded": {
      const text = getText();
      try {
        return Object.fromEntries(new URLSearchParams(text).entries());
      } catch (e) {
        throw new KnownErrors.BodyParsingError("Invalid form data in request body");
      }
    }
    default: {
      throw new KnownErrors.BodyParsingError("Unknown content type in request body: " + contentType);
    }
  }
}

const parseAuth = withTraceSpan('smart request parseAuth', async (req: NextRequest): Promise<SmartRequestAuth | null> => {
  const projectId = req.headers.get("x-stack-project-id");
  let requestType = req.headers.get("x-stack-access-type");
  const publishableClientKey = req.headers.get("x-stack-publishable-client-key");
  const secretServerKey = req.headers.get("x-stack-secret-server-key");
  const superSecretAdminKey = req.headers.get("x-stack-super-secret-admin-key");
  const adminAccessToken = req.headers.get("x-stack-admin-access-token");
  const accessToken = req.headers.get("x-stack-access-token");
  const developmentKeyOverride = req.headers.get("x-stack-development-override-key");  // in development, the internal project's API key can optionally be used to access any project

  const extractUserIdAndRefreshTokenIdFromAccessToken = async (options: { token: string, projectId: string }) => {
    const result = await decodeAccessToken(options.token);
    if (result.status === "error") {
      throw result.error;
    }

    if (result.data.projectId !== options.projectId) {
      throw new KnownErrors.InvalidProjectForAccessToken(options.projectId, result.data.projectId);
    }

    return {
      userId: result.data.userId,
      refreshTokenId: result.data.refreshTokenId,
    };
  };

  const extractUserFromAdminAccessToken = async (options: { token: string, projectId: string }) => {
    const result = await decodeAccessToken(options.token);
    if (result.status === "error") {
      if (result.error instanceof KnownErrors.AccessTokenExpired) {
        throw new KnownErrors.AdminAccessTokenExpired(result.error.constructorArgs[0]);
      } else {
        throw new KnownErrors.UnparsableAdminAccessToken();
      }
    }

    if (result.data.projectId !== "internal") {
      throw new KnownErrors.AdminAccessTokenIsNotAdmin();
    }

    const user = await getUser({ projectId: 'internal', branchId: 'main', userId: result.data.userId });
    if (!user) {
      // this is the case when access token is still valid, but the user is deleted from the database
      // this should be very rare, let's log it on Sentry when it happens
      captureError("admin-access-token-expiration", new StackAssertionError("User not found for admin access token. This may not be a bug, but it's worth investigating"));
      throw new StatusError(401, "The user associated with the admin access token is no longer valid. Please refresh the admin access token and try again.");
    }

    const allProjects = listManagedProjectIds(user);
    if (!allProjects.includes(options.projectId)) {
      throw new KnownErrors.AdminAccessTokenIsNotAdmin();
    }

    return user;
  };

  const { userId, refreshTokenId } =  projectId && accessToken ? await extractUserIdAndRefreshTokenIdFromAccessToken({ token: accessToken, projectId }): { userId: null, refreshTokenId: null };

  // Prisma does a query for every function call by default, even if we batch them with transactions
  // Because smart route handlers are always called, we instead send over a single raw query that fetches all the
  // data at the same time, saving us a lot of requests
  const bundledQueries = {
    user: userId && projectId ? getUserQuery(projectId, null, userId) : undefined,
    isClientKeyValid: projectId && publishableClientKey && requestType === "client" ? checkApiKeySetQuery(projectId, { publishableClientKey }) : undefined,
    isServerKeyValid: projectId && secretServerKey && requestType === "server" ? checkApiKeySetQuery(projectId, { secretServerKey }) : undefined,
    isAdminKeyValid: projectId && superSecretAdminKey && requestType === "admin" ? checkApiKeySetQuery(projectId, { superSecretAdminKey }) : undefined,
    project: projectId ? getProjectQuery(projectId) : undefined,
  };
  const queriesResults = await rawQueryAll(bundledQueries);

  const eitherKeyOrToken = !!(publishableClientKey || secretServerKey || superSecretAdminKey || adminAccessToken);

  if (!requestType && eitherKeyOrToken) {
    throw new KnownErrors.ProjectKeyWithoutAccessType();
  }
  if (!requestType) return null;
  if (!typedIncludes(["client", "server", "admin"] as const, requestType)) throw new KnownErrors.InvalidAccessType(requestType);
  if (!projectId) throw new KnownErrors.AccessTypeWithoutProjectId(requestType);

  if (developmentKeyOverride) {
    if (getNodeEnvironment() !== "development" && getNodeEnvironment() !== "test") {
      throw new StatusError(401, "Development key override is only allowed in development or test environments");
    }
    const result = await checkApiKeySet("internal", { superSecretAdminKey: developmentKeyOverride });
    if (!result) throw new StatusError(401, "Invalid development key override");
  } else if (adminAccessToken) {
    // TODO put the assertion below into the bundled queries above (not so important because this path is quite rare)
    await extractUserFromAdminAccessToken({ token: adminAccessToken, projectId });  // assert that the admin token is valid
    if (!queriesResults.project) {
      // this happens if the project is still in the user's managedProjectIds, but has since been deleted
      throw new KnownErrors.InvalidProjectForAdminAccessToken();
    }
  } else {
    switch (requestType) {
      case "client": {
        if (!publishableClientKey) throw new KnownErrors.ClientAuthenticationRequired();
        if (!queriesResults.isClientKeyValid) throw new KnownErrors.InvalidPublishableClientKey(projectId);
        break;
      }
      case "server": {
        if (!secretServerKey) throw new KnownErrors.ServerAuthenticationRequired();
        if (!queriesResults.isServerKeyValid) throw new KnownErrors.InvalidSecretServerKey(projectId);
        break;
      }
      case "admin": {
        if (!superSecretAdminKey) throw new KnownErrors.AdminAuthenticationRequired;
        if (!queriesResults.isAdminKeyValid) throw new KnownErrors.InvalidSuperSecretAdminKey(projectId);
        break;
      }
      default: {
        throw new StackAssertionError(`Unexpected request type: ${requestType}. This should never happen because we should've filtered this earlier`);
      }
    }
  }

  const project = queriesResults.project;
  if (!project) {
    // This happens when the JWT tokens are still valid, but the project has been deleted
    throw new KnownErrors.ProjectNotFound(projectId);
  }

  return {
    project,
    branchId: "main",
    refreshTokenId: refreshTokenId ?? undefined,
    tenancy: await getSoleTenancyFromProject(project),
    user: queriesResults.user ?? undefined,
    type: requestType,
  };
});

export async function createSmartRequest(req: NextRequest, bodyBuffer: ArrayBuffer, options?: { params: Promise<Record<string, string>> }): Promise<SmartRequest> {
  return await traceSpan("creating smart request", async () => {
    const urlObject = new URL(req.url);
    const clientVersionMatch = req.headers.get("x-stack-client-version")?.match(/^(\w+)\s+(@[\w\/]+)@([\d.]+)$/);

    return {
      url: req.url,
      method: typedIncludes(allowedMethods, req.method) ? req.method : throwErr(new StatusError(405, "Method not allowed")),
      body: await parseBody(req, bodyBuffer),
      headers: Object.fromEntries(
        [...groupBy(req.headers.entries(), ([key, _]) => key.toLowerCase())]
          .map(([key, values]) => [key, values.map(([_, value]) => value)]),
      ),
      query: Object.fromEntries(urlObject.searchParams.entries()),
      params: await options?.params ?? {},
      auth: await parseAuth(req),
      clientVersion: clientVersionMatch ? {
        platform: clientVersionMatch[1],
        sdk: clientVersionMatch[2],
        version: clientVersionMatch[3],
      } : undefined,
    } satisfies SmartRequest;
  });
}

export async function validateSmartRequest<T extends DeepPartialSmartRequestWithSentinel>(nextReq: NextRequest | null, smartReq: SmartRequest, schema: yup.Schema<T>): Promise<T> {
  return await validate(smartReq, schema, nextReq);
}
