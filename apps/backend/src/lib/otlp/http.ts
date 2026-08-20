import { decodeOtlpProtobufRequest, encodeOtlpProtobufResponse, type OtlpSignal } from "./protobuf";
import { scrubErrorIngestPayload } from "@/lib/error-ingest";
import type { Json } from "@hexclave/shared/dist/utils/json";

export type OtlpHttpEncoding = "json" | "protobuf";

export class OtlpHttpError extends Error {}

const OTLP_ERROR_MESSAGE_LIMITS = {
  maxPayloadBytes: 512,
  maxStringBytes: 512,
};

export function scrubOtlpErrorMessage(message: string, fallback: string): string {
  const scrubbed = scrubErrorIngestPayload(message, OTLP_ERROR_MESSAGE_LIMITS);
  return typeof scrubbed.value === "string" && scrubbed.value.length > 0
    ? scrubbed.value
    : fallback;
}

export function getOtlpHttpEncoding(headers: Record<string, string[] | undefined>): OtlpHttpEncoding {
  const contentType = headers["content-type"]?.[0]?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType === "application/json") return "json";
  if (contentType === "application/x-protobuf") return "protobuf";
  throw new OtlpHttpError("OTLP/HTTP requests must use application/json or application/x-protobuf");
}

export function decodeOtlpHttpRequest(
  signal: OtlpSignal,
  encoding: OtlpHttpEncoding,
  body: unknown,
): unknown {
  if (encoding === "json") return body;
  if (!(body instanceof ArrayBuffer) && !(body instanceof Uint8Array)) {
    throw new OtlpHttpError("OTLP protobuf request body must be binary");
  }
  return decodeOtlpProtobufRequest(signal, body);
}

type OtlpPartialSuccess = {
  rejectedItems: number,
  errorMessage: string,
};

type OtlpJsonResponse = { [key: string]: Json };

type OtlpHttpResponse = {
  statusCode: 200,
  headers: { "content-type": [string] },
  body: OtlpJsonResponse | ArrayBuffer,
};

function toArrayBuffer(value: Uint8Array): ArrayBuffer {
  const result = new ArrayBuffer(value.byteLength);
  new Uint8Array(result).set(value);
  return result;
}

export function createOtlpHttpResponse(
  signal: OtlpSignal,
  encoding: OtlpHttpEncoding,
  partialSuccess?: OtlpPartialSuccess,
): OtlpHttpResponse {
  let partialSuccessBody: OtlpJsonResponse = {};
  if (partialSuccess !== undefined) {
    const partialSuccessFields: OtlpJsonResponse = {
      errorMessage: partialSuccess.errorMessage,
    };
    if (signal === "traces") {
      partialSuccessFields.rejectedSpans = String(partialSuccess.rejectedItems);
    } else if (signal === "logs") {
      partialSuccessFields.rejectedLogRecords = String(partialSuccess.rejectedItems);
    } else {
      partialSuccessFields.rejectedDataPoints = String(partialSuccess.rejectedItems);
    }
    partialSuccessBody = { partialSuccess: partialSuccessFields };
  }

  if (encoding === "json") {
    return {
      statusCode: 200,
      body: partialSuccessBody,
      headers: { "content-type": ["application/json"] },
    };
  }
  return {
    statusCode: 200,
    body: toArrayBuffer(encodeOtlpProtobufResponse(signal, partialSuccessBody)),
    headers: { "content-type": ["application/x-protobuf"] },
  };
}
