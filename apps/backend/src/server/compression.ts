const compressibleApplicationTypes = new Set([
  "application/graphql-response+json",
  "application/javascript",
  "application/json",
  "application/ld+json",
  "application/problem+json",
  "application/xml",
  "application/x-javascript",
  "image/svg+xml",
]);

export function compressResponse(request: Request, response: Response): Response {
  if (!canCompressResponse(request, response)) {
    return response;
  }

  const headers = new Headers(response.headers);
  headers.set("Content-Encoding", "gzip");
  appendVaryHeader(headers, "Accept-Encoding");
  // These values describe the uncompressed representation and become invalid
  // after the streaming transform.
  headers.delete("Content-Length");
  headers.delete("Content-MD5");
  headers.delete("Digest");
  headers.delete("ETag");
  headers.delete("Accept-Ranges");

  return new Response(
    response.body?.pipeThrough(new CompressionStream("gzip")),
    {
      status: response.status,
      statusText: response.statusText,
      headers,
    },
  );
}

function canCompressResponse(request: Request, response: Response): boolean {
  if (
    request.method === "HEAD"
    || request.headers.has("range")
    || response.body == null
    || response.status < 200
    || response.status === 204
    || response.status === 205
    || response.status === 304
    || response.headers.has("content-encoding")
    || response.headers.has("content-range")
    || hasNoTransformDirective(response.headers.get("cache-control"))
    || !isCompressibleContentType(response.headers.get("content-type"))
  ) {
    return false;
  }
  return acceptsGzip(request.headers.get("accept-encoding"));
}

function hasNoTransformDirective(cacheControl: string | null): boolean {
  return cacheControl?.split(",").some((directive) => directive.trim().toLowerCase() === "no-transform") ?? false;
}

function isCompressibleContentType(contentTypeHeader: string | null): boolean {
  const contentType = contentTypeHeader?.split(";", 1)[0]?.trim().toLowerCase();
  return contentType?.startsWith("text/") === true
    || contentType?.endsWith("+json") === true
    || contentType?.endsWith("+xml") === true
    || (contentType != null && compressibleApplicationTypes.has(contentType));
}

function acceptsGzip(acceptEncodingHeader: string | null): boolean {
  if (acceptEncodingHeader == null) {
    return false;
  }
  let gzipQuality: number | undefined;
  let wildcardQuality: number | undefined;
  for (const entry of acceptEncodingHeader.split(",")) {
    const [rawEncoding, ...rawParameters] = entry.trim().toLowerCase().split(";");
    const qualityParameter = rawParameters.find((parameter) => parameter.trim().startsWith("q="));
    const parsedQuality = qualityParameter == null ? 1 : Number(qualityParameter.trim().slice(2));
    const quality = Number.isFinite(parsedQuality) && parsedQuality >= 0 && parsedQuality <= 1 ? parsedQuality : 0;
    if (rawEncoding === "gzip" || rawEncoding === "x-gzip") {
      gzipQuality = quality;
    } else if (rawEncoding === "*") {
      wildcardQuality = quality;
    }
  }
  return (gzipQuality ?? wildcardQuality ?? 0) > 0;
}

function appendVaryHeader(headers: Headers, value: string): void {
  const existingValues = headers.get("vary")?.split(",").map((entry) => entry.trim().toLowerCase()) ?? [];
  if (!existingValues.includes(value.toLowerCase())) {
    headers.append("Vary", value);
  }
}

import.meta.vitest?.test("compresses eligible responses as a streaming gzip representation", async ({ expect }) => {
  const { gunzipSync } = await import("node:zlib");
  const body = JSON.stringify({ value: "repeated-value-".repeat(100) });
  const response = compressResponse(
    new Request("http://localhost/test", {
      headers: { "accept-encoding": "br, gzip;q=0.8" },
    }),
    new Response(body, {
      headers: {
        "content-length": String(body.length),
        "content-type": "application/json",
        etag: '"uncompressed"',
      },
    }),
  );

  expect({
    contentEncoding: response.headers.get("content-encoding"),
    contentLength: response.headers.get("content-length"),
    etag: response.headers.get("etag"),
    vary: response.headers.get("vary"),
    body: gunzipSync(Buffer.from(await response.arrayBuffer())).toString(),
  }).toEqual({
    contentEncoding: "gzip",
    contentLength: null,
    etag: null,
    vary: "Accept-Encoding",
    body,
  });
});

import.meta.vitest?.test("does not compress ineligible or refused representations", ({ expect }) => {
  const response = Response.json({ ok: true });
  expect(compressResponse(new Request("http://localhost/test"), response)).toBe(response);
  expect(compressResponse(new Request("http://localhost/test", {
    headers: { "accept-encoding": "gzip;q=0, *;q=1" },
  }), response)).toBe(response);
  const noTransformResponse = new Response("sensitive", {
    headers: {
      "cache-control": "private, no-transform",
      "content-type": "text/plain",
    },
  });
  expect(compressResponse(new Request("http://localhost/test", {
    headers: { "accept-encoding": "gzip" },
  }), noTransformResponse)).toBe(noTransformResponse);
});
