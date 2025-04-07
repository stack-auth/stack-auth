import "../polyfills";

import { traceSpan } from "@/utils/telemetry";
import * as Sentry from "@sentry/nextjs";
import { EndpointDocumentation } from "@stackframe/stack-shared/dist/crud";
import { KnownError, KnownErrors } from "@stackframe/stack-shared/dist/known-errors";
import { generateSecureRandomString } from "@stackframe/stack-shared/dist/utils/crypto";
import { getNodeEnvironment } from "@stackframe/stack-shared/dist/utils/env";
import { StackAssertionError, StatusError, captureError, errorToNiceString } from "@stackframe/stack-shared/dist/utils/errors";
import { runAsynchronously, wait } from "@stackframe/stack-shared/dist/utils/promises";
import { NextRequest } from "next/server";
import * as yup from "yup";
import { DeepPartialSmartRequestWithSentinel, MergeSmartRequest, SmartRequest, createSmartRequest, validateSmartRequest } from "./smart-request";
import { SmartResponse, createResponse, validateSmartResponse } from "./smart-response";

class InternalServerError extends StatusError {
  constructor(error: unknown, requestId: string) {
    super(
      StatusError.InternalServerError,
      ["development", "test"].includes(getNodeEnvironment()) ? `Internal Server Error. The error message follows, but will be stripped in production. ${errorToNiceString(error)}` : `Something went wrong. Please make sure the data you entered is correct.\n\nRequest ID: ${requestId}`,
    );
  }
}

/**
 * Known errors that are common and should not be logged with their stacktrace.
 */
const commonErrors = [
  ...getNodeEnvironment() === "development" ? [KnownError] : [],
  KnownErrors.AccessTokenExpired,
  KnownErrors.CannotGetOwnUserWithoutUser,
  InternalServerError,
];

/**
 * Catches the given error, logs it if needed and returns it as a StatusError. Errors that are not actually errors
 * (such as Next.js redirects) will be re-thrown.
 */
function catchError(error: unknown, requestId: string): StatusError {
  // catch some Next.js non-errors and rethrow them
  if (error instanceof Error) {
    const digest = (error as any)?.digest;
    if (typeof digest === "string") {
      if (["NEXT_REDIRECT", "DYNAMIC_SERVER_USAGE", "NEXT_NOT_FOUND"].some(m => digest.startsWith(m))) {
        throw error;
      }
    }
  }

  if (error instanceof StatusError) return error;
  captureError(`route-handler`, error);
  return new InternalServerError(error, requestId);
}

/**
 * A unique identifier for the current process. This is used to correlate logs in serverless environments that allow
 * multiple concurrent requests to be handled by the same instance.
 */
const processId = generateSecureRandomString(80);
let concurrentRequestsInProcess = 0;

/**
 * Catches any errors thrown in the handler and returns a 500 response with the thrown error message. Also logs the
 * request details.
 */
export function handleApiRequest(handler: (req: NextRequest, options: any, requestId: string) => Promise<Response>): (req: NextRequest, options: any) => Promise<Response> {
  return async (req: NextRequest, options: any) => {
    concurrentRequestsInProcess++;
    try {
      const requestId = generateSecureRandomString(80);
      return await traceSpan({
        description: 'handling API request',
        attributes: {
          "stack.request.request-id": requestId,
          "stack.request.method": req.method,
          "stack.request.url": req.url,
          "stack.process.id": processId,
          "stack.process.concurrent-requests": concurrentRequestsInProcess,
        },
      }, async (span) => {
        // Set Sentry scope to include request details
        Sentry.setContext("stack-request", {
          requestId: requestId,
          method: req.method,
          url: req.url,
          query: Object.fromEntries(req.nextUrl.searchParams),
          headers: Object.fromEntries(req.headers),
        });

        // During development, don't trash the console with logs from E2E tests
        const disableExtendedLogging = getNodeEnvironment().includes('dev') && !!req.headers.get("x-stack-development-disable-extended-logging");

        let hasRequestFinished = false;
        try {
          // censor long query parameters because they might contain sensitive data
          const censoredUrl = new URL(req.url);
          for (const [key, value] of censoredUrl.searchParams.entries()) {
            if (value.length <= 8) {
              continue;
            }
            censoredUrl.searchParams.set(key, value.slice(0, 4) + "--REDACTED--" + value.slice(-4));
          }

          // request duration warning
          const warnAfterSeconds = 12;
          runAsynchronously(async () => {
            await wait(warnAfterSeconds * 1000);
            if (!hasRequestFinished) {
              captureError("request-timeout-watcher", new Error(`Request with ID ${requestId} to endpoint ${req.nextUrl.pathname} has been running for ${warnAfterSeconds} seconds. Try to keep requests short. The request may be cancelled by the serverless provider if it takes too long.`));
            }
          });

          if (!disableExtendedLogging) console.log(`[API REQ] [${requestId}] ${req.method} ${censoredUrl}`);
          const timeStart = performance.now();
          const res = await handler(req, options, requestId);
          const time = (performance.now() - timeStart);
          if ([301, 302].includes(res.status)) {
            throw new StackAssertionError("HTTP status codes 301 and 302 should not be returned by our APIs because the behavior for non-GET methods is inconsistent across implementations. Use 303 (to rewrite method to GET) or 307/308 (to preserve the original method and data) instead.", { status: res.status, url: req.nextUrl, req, res });
          }
          if (!disableExtendedLogging) console.log(`[    RES] [${requestId}] ${req.method} ${censoredUrl}: ${res.status} (in ${time.toFixed(0)}ms)`);
          return res;
        } catch (e) {
          let statusError: StatusError;
          try {
            statusError = catchError(e, requestId);
          } catch (e) {
            if (!disableExtendedLogging) console.log(`[    EXC] [${requestId}] ${req.method} ${req.url}: Non-error caught (such as a redirect), will be re-thrown. Digest: ${(e as any)?.digest}`);
            throw e;
          }

          if (!disableExtendedLogging) console.log(`[    ERR] [${requestId}] ${req.method} ${req.url}: ${statusError.message}`);

          if (!commonErrors.some(e => statusError instanceof e)) {
            // HACK: Log a nicified version of the error instead of statusError to get around buggy Next.js pretty-printing
            // https://www.reddit.com/r/nextjs/comments/1gkxdqe/comment/m19kxgn/?utm_source=share&utm_medium=web3x&utm_name=web3xcss&utm_term=1&utm_content=share_button
            if (!disableExtendedLogging) console.debug(`For the error above with request ID ${requestId}, the full error is:`, errorToNiceString(statusError));
          }

          const res = await createResponse(req, requestId, {
            statusCode: statusError.statusCode,
            bodyType: "binary",
            body: statusError.getBody(),
            headers: {
              ...statusError.getHeaders(),
            },
          });
          return res;
        } finally {
          hasRequestFinished = true;
        }
      });
    } finally {
      concurrentRequestsInProcess--;
    }
  };
};

export type SmartRouteHandlerOverloadMetadata = EndpointDocumentation;

export type SmartRouteHandlerOverload<
  Req extends DeepPartialSmartRequestWithSentinel,
  Res extends SmartResponse,
> = {
  metadata?: SmartRouteHandlerOverloadMetadata,
  request: yup.Schema<Req>,
  response: yup.Schema<Res>,
  handler: (req: MergeSmartRequest<Req>, fullReq: SmartRequest) => Promise<Res>,
};

export type SmartRouteHandlerOverloadGenerator<
  OverloadParam,
  Req extends DeepPartialSmartRequestWithSentinel,
  Res extends SmartResponse,
> = (param: OverloadParam) => SmartRouteHandlerOverload<Req, Res>;

export type SmartRouteHandler<
  OverloadParam = unknown,
  Req extends DeepPartialSmartRequestWithSentinel = DeepPartialSmartRequestWithSentinel,
  Res extends SmartResponse = SmartResponse,
  InitArgs extends [readonly OverloadParam[], SmartRouteHandlerOverloadGenerator<OverloadParam, Req, Res>] | [SmartRouteHandlerOverload<Req, Res>] = any,
> = ((req: NextRequest, options: any) => Promise<Response>) & {
  overloads: Map<OverloadParam, SmartRouteHandlerOverload<Req, Res>>,
  invoke: (smartRequest: SmartRequest) => Promise<Res>,
  initArgs: InitArgs,
}

function getSmartRouteHandlerSymbol() {
  return Symbol.for("stack-smartRouteHandler");
}

export function isSmartRouteHandler(handler: any): handler is SmartRouteHandler {
  return handler?.[getSmartRouteHandlerSymbol()] === true;
}

export function createSmartRouteHandler<
  Req extends DeepPartialSmartRequestWithSentinel,
  Res extends SmartResponse,
>(
  handler: SmartRouteHandlerOverload<Req, Res>,
): SmartRouteHandler<void, Req, Res, [typeof handler]>
export function createSmartRouteHandler<
  OverloadParam,
  Req extends DeepPartialSmartRequestWithSentinel,
  Res extends SmartResponse,
>(
  overloadParams: readonly OverloadParam[],
  overloadGenerator: SmartRouteHandlerOverloadGenerator<OverloadParam, Req, Res>
): SmartRouteHandler<OverloadParam, Req, Res, [typeof overloadParams, typeof overloadGenerator]>
export function createSmartRouteHandler<
  Req extends DeepPartialSmartRequestWithSentinel,
  Res extends SmartResponse,
>(
  ...args: [readonly unknown[], SmartRouteHandlerOverloadGenerator<unknown, Req, Res>] | [SmartRouteHandlerOverload<Req, Res>]
): SmartRouteHandler<unknown, Req, Res> {
  const overloadParams = args.length > 1 ? args[0] as unknown[] : [undefined];
  const overloadGenerator = args.length > 1 ? args[1]! : () => (args[0] as SmartRouteHandlerOverload<Req, Res>);

  const overloads = new Map(overloadParams.map((overloadParam) => [
    overloadParam,
    overloadGenerator(overloadParam),
  ]));
  if (overloads.size !== overloadParams.length) {
    throw new StackAssertionError("Duplicate overload parameters");
  }

  const invoke = async (nextRequest: NextRequest | null, requestId: string, smartRequest: SmartRequest, shouldSetContext: boolean = false) => {
    const reqsParsed: [[Req, SmartRequest], SmartRouteHandlerOverload<Req, Res>][] = [];
    const reqsErrors: unknown[] = [];
    for (const [overloadParam, overload] of overloads.entries()) {
      try {
        const parsedReq = await traceSpan("validating smart request", async () => {
          return await validateSmartRequest(nextRequest, smartRequest, overload.request);
        });
        reqsParsed.push([[parsedReq, smartRequest], overload]);
      } catch (e) {
        reqsErrors.push(e);
      }
    }
    if (reqsParsed.length === 0) {
      if (reqsErrors.length === 1) {
        throw reqsErrors[0];
      } else {
        const caughtErrors = reqsErrors.map(e => catchError(e, requestId));
        throw createOverloadsError(caughtErrors);
      }
    }

    const smartReq = reqsParsed[0][0][0];
    const fullReq = reqsParsed[0][0][1];
    const handler = reqsParsed[0][1];

    if (shouldSetContext) {
      Sentry.setContext("stack-parsed-smart-request", smartReq as any);
    }

    let smartRes = await traceSpan({
      description: 'calling smart route handler callback',
      attributes: {
        "user.id": fullReq.auth?.user?.id ?? "<none>",
        "stack.smart-request.project.id": fullReq.auth?.project.id ?? "<none>",
        "stack.smart-request.project.display_name": fullReq.auth?.project.display_name ?? "<none>",
        "stack.smart-request.user.id": fullReq.auth?.user?.id ?? "<none>",
        "stack.smart-request.user.display-name": fullReq.auth?.user?.display_name ?? "<none>",
        "stack.smart-request.user.primary-email": fullReq.auth?.user?.primary_email ?? "<none>",
        "stack.smart-request.access-type": fullReq.auth?.type ?? "<none>",
      },
    }, async () => {
      return await handler.handler(smartReq as any, fullReq);
    });

    return await traceSpan("validating smart response", async () => {
      return await validateSmartResponse(nextRequest, fullReq, smartRes, handler.response);
    });
  };

  return Object.assign(handleApiRequest(async (req, options, requestId) => {
    const bodyBuffer = await req.arrayBuffer();
    const smartRequest = await createSmartRequest(req, bodyBuffer, options);

    Sentry.setContext("stack-full-smart-request", smartRequest);

    const smartRes = await invoke(req, requestId, smartRequest, true);

    return await createResponse(req, requestId, smartRes);
  }), {
    [getSmartRouteHandlerSymbol()]: true,
    invoke: (smartRequest: SmartRequest) => invoke(null, "custom-endpoint-invocation", smartRequest),
    overloads,
    initArgs: args,
  });
}

function createOverloadsError(errors: StatusError[]) {
  const merged = mergeOverloadErrors(errors);
  if (merged.length === 1) {
    return merged[0];
  }
  return new KnownErrors.AllOverloadsFailed(merged.map(e => e.toDescriptiveJson()));
}

const mergeErrorPriority = [
  // any other error is first, then errors get priority in the following order
  // if an error has priority over another, the latter will be hidden when listing failed overloads
  KnownErrors.InsufficientAccessType,
];

function mergeOverloadErrors(errors: StatusError[]): StatusError[] {
  if (errors.length > 6) {
    // TODO fix this
    throw new StackAssertionError("Too many overloads failed, refusing to trying to merge them as it would be computationally expensive and could be used for a DoS attack. Fix this if we ever have an endpoint with > 8 overloads");
  } else if (errors.length === 0) {
    throw new StackAssertionError("No errors to merge");
  } else if (errors.length === 1) {
    return [errors[0]];
  } else if (errors.length === 2) {
    for (const [a, b] of [errors, [...errors].reverse()]) {
      // Merge errors with the same JSON
      if (JSON.stringify(a.toDescriptiveJson()) === JSON.stringify(b.toDescriptiveJson())) {
        return [a];
      }

      // Merge "InsufficientAccessType" errors
      if (
        a instanceof KnownErrors.InsufficientAccessType
        && b instanceof KnownErrors.InsufficientAccessType
        && a.constructorArgs[0] === b.constructorArgs[0]
      ) {
        return [new KnownErrors.InsufficientAccessType(a.constructorArgs[0], [...new Set([...a.constructorArgs[1], ...b.constructorArgs[1]])])];
      }

      // Merge priority
      const aPriority = mergeErrorPriority.indexOf(a.constructor as any);
      const bPriority = mergeErrorPriority.indexOf(b.constructor as any);
      if (aPriority < bPriority) {
        return [a];
      }
    }
    return errors;
  } else {
    // brute-force all combinations recursively
    let fewestErrors: StatusError[] = errors;
    for (let i = 0; i < errors.length; i++) {
      const errorsWithoutCurrent = [...errors];
      errorsWithoutCurrent.splice(i, 1);
      const mergedWithoutCurrent = mergeOverloadErrors(errorsWithoutCurrent);
      if (mergedWithoutCurrent.length < errorsWithoutCurrent.length) {
        const merged = mergeOverloadErrors([errors[i], ...mergedWithoutCurrent]);
        if (merged.length < fewestErrors.length) {
          fewestErrors = merged;
        }
      }
    }
    return fewestErrors;
  }
}

/**
 * needed in the multi-overload smartRouteHandler for weird TypeScript reasons that I don't understand
 *
 * if you can remove this wherever it's used without causing type errors, it's safe to remove
 */
export function routeHandlerTypeHelper<Req extends DeepPartialSmartRequestWithSentinel, Res extends SmartResponse>(handler: {
  request: yup.Schema<Req>,
  response: yup.Schema<Res>,
  handler: (req: Req & MergeSmartRequest<Req>, fullReq: SmartRequest) => Promise<Res>,
}): {
  request: yup.Schema<Req>,
  response: yup.Schema<Res>,
  handler: (req: Req & MergeSmartRequest<Req>, fullReq: SmartRequest) => Promise<Res>,
} {
  return handler;
}
