import type { Attributes, Meter } from "@opentelemetry/api";

const OTHER_METHOD = "_OTHER";

type HttpMetricRequest = {
  method?: string,
};

function normalizeMethod(method: string | undefined): string {
  if (method === undefined) return "GET";
  if (!/^[A-Za-z]{1,16}$/u.test(method)) return OTHER_METHOD;
  return method.toUpperCase();
}

function normalizedStatusCode(statusCode: number | undefined): number | undefined {
  if (statusCode === undefined || !Number.isSafeInteger(statusCode) || statusCode < 100 || statusCode > 599) return undefined;
  return statusCode;
}

function normalizedErrorType(errorType: string | undefined): string | undefined {
  if (errorType === undefined || errorType.length === 0) return undefined;
  return /^[A-Za-z0-9_.:-]{1,64}$/u.test(errorType) ? errorType : "error";
}

function requestAttributes(method: string, statusCode: number | undefined, errorType: string | undefined): Attributes {
  const attributes: Attributes = {
    "http.request.method": method,
  };
  const normalizedStatus = normalizedStatusCode(statusCode);
  if (normalizedStatus !== undefined) attributes["http.response.status_code"] = normalizedStatus;
  const normalizedError = normalizedErrorType(errorType);
  if (normalizedError !== undefined) attributes["error.type"] = normalizedError;
  return attributes;
}

/**
 * Records request observations from the instrumentation hooks themselves.
 * The measurements are not reconstructed from completed spans, which keeps
 * native Metrics available even when trace sampling drops the corresponding
 * span data.
 */
export class OtlpHttpMetricRecorder {
  private readonly _requestCount;
  private readonly _requestDuration;
  private readonly _startedAt = new WeakMap<object, { method: string, startedAt: number }>();

  constructor(meter: Meter) {
    this._requestCount = meter.createCounter("hexclave.http.client.request.count", {
      description: "Number of outbound HTTP requests observed by the Hexclave SDK",
      unit: "{request}",
    });
    this._requestDuration = meter.createHistogram("hexclave.http.client.request.duration", {
      description: "Duration of outbound HTTP requests observed by the Hexclave SDK",
      unit: "s",
    });
  }

  start(key: object, request: HttpMetricRequest): void {
    this._startedAt.set(key, { method: normalizeMethod(request.method), startedAt: performance.now() });
  }

  end(key: object, statusCode?: number, errorType?: string): void {
    const started = this._startedAt.get(key);
    if (started === undefined) return;
    this._startedAt.delete(key);

    const attributes = requestAttributes(started.method, statusCode, errorType);
    this._requestCount.add(1, attributes);
    this._requestDuration.record(Math.max(0, performance.now() - started.startedAt) / 1_000, attributes);
  }
}
