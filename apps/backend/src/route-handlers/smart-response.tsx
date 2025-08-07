import { yupValidate } from "@stackframe/stack-shared/dist/schema-fields";
import { StackAssertionError } from "@stackframe/stack-shared/dist/utils/errors";
import { Json } from "@stackframe/stack-shared/dist/utils/json";
import { deepPlainEquals } from "@stackframe/stack-shared/dist/utils/objects";
import { traceSpan } from "@stackframe/stack-shared/dist/utils/telemetry";
import { NextRequest } from "next/server";
import * as yup from "yup";
import "../polyfills";
import { SmartRequest } from "./smart-request";

export type SmartResponse = {
  statusCode: number,
  headers?: Record<string, string[]>,
} & (
  | {
    bodyType?: undefined,
    body?: ArrayBuffer | Json | undefined,
  }
  | {
    bodyType: "empty",
    body?: undefined,
  }
  | {
    bodyType: "text",
    body: string,
  }
  | {
    bodyType: "json",
    body: Json,
  }
  | {
    bodyType: "binary",
    body: ArrayBuffer,
  }
  | {
    bodyType: "success",
    body?: undefined,
  }
);

export async function validateSmartResponse<T>(req: NextRequest | null, smartReq: SmartRequest, obj: unknown, schema: yup.Schema<T>): Promise<T> {
  try {
    return await yupValidate(schema, obj, {
      abortEarly: false,
      context: {
        noUnknownPathPrefixes: [""],
      },
      currentUserId: smartReq.auth?.user?.id ?? null,
    });
  } catch (error) {
    throw new StackAssertionError(`Error occurred during ${req ? `${req.method} ${req.url}` : "a custom endpoint invocation's"} response validation: ${error}`, { obj, schema, cause: error });
  }
}


function isBinaryBody(body: unknown): body is BodyInit {
  return body instanceof ArrayBuffer
    || body instanceof SharedArrayBuffer
    || body instanceof Blob
    || ArrayBuffer.isView(body);
}

export async function createResponse<T extends SmartResponse>(req: NextRequest | null, requestId: string, obj: T): Promise<Response> {
  return await traceSpan("creating HTTP response from smart response", async () => {
    let status = obj.statusCode;
    const headers = new Map<string, string[]>();

    let arrayBufferBody;

    // if we have something that resembles a browser, prettify JSON outputs
    const jsonIndent = req?.headers.get("Accept")?.includes("text/html") ? 2 : undefined;

    const bodyType = obj.bodyType ?? (obj.body === undefined ? "empty" : isBinaryBody(obj.body) ? "binary" : "json");
    switch (bodyType) {
      case "empty": {
        arrayBufferBody = new ArrayBuffer(0);
        break;
      }
      case "json": {
        if (obj.body === undefined || !deepPlainEquals(obj.body, JSON.parse(JSON.stringify(obj.body)), { ignoreUndefinedValues: true })) {
          throw new StackAssertionError("Invalid JSON body is not JSON", { body: obj.body });
        }
        headers.set("content-type", ["application/json; charset=utf-8"]);
        arrayBufferBody = new TextEncoder().encode(JSON.stringify(obj.body, null, jsonIndent));
        break;
      }
      case "text": {
        headers.set("content-type", ["text/plain; charset=utf-8"]);
        if (typeof obj.body !== "string") throw new Error(`Invalid body, expected string, got ${obj.body}`);
        arrayBufferBody = new TextEncoder().encode(obj.body);
        break;
      }
      case "binary": {
        if (!isBinaryBody(obj.body)) throw new Error(`Invalid body, expected ArrayBuffer, got ${obj.body}`);
        arrayBufferBody = obj.body;
        break;
      }
      case "success": {
        headers.set("content-type", ["application/json; charset=utf-8"]);
        arrayBufferBody = new TextEncoder().encode(JSON.stringify({
          success: true,
        }, null, jsonIndent));
        break;
      }
      default: {
        throw new Error(`Invalid body type: ${bodyType}`);
      }
    }


    // Add the request ID to the response headers
    headers.set("x-stack-request-id", [requestId]);


    // Disable caching by default
    headers.set("cache-control", ["no-store, max-age=0"]);


    // If the x-stack-override-error-status header is given, override error statuses to 200
    if (req?.headers.has("x-stack-override-error-status") && status >= 400 && status < 600) {
      status = 200;
      headers.set("x-stack-actual-status", [obj.statusCode.toString()]);
    }

    return new Response(
      arrayBufferBody,
      {
        status,
        headers: [
          ...Object.entries({
            ...Object.fromEntries(headers),
            ...obj.headers ?? {}
          }).flatMap(([key, values]) => values.map(v => [key.toLowerCase(), v!] as [string, string])),
        ],
      },
    );
  });
}
