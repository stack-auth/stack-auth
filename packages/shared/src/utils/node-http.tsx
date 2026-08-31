import { IncomingMessage, ServerResponse } from "http";
import { getRelativePart } from "./urls";

class ServerResponseWithBodyChunks extends ServerResponse {
  bodyChunks: Uint8Array[] = [];

  // note: we actually override this, even though it's private in the parent
  _send(data: string, encoding: BufferEncoding, callback?: (() => void) | null, byteLength?: number) {
    if (typeof encoding === "function") {
      callback = encoding;
      encoding = "utf-8";
    }
    const encodedBuffer = new Uint8Array(Buffer.from(data, encoding));
    this.bodyChunks.push(encodedBuffer);
    callback?.();
  }
}

export async function createNodeHttpServerDuplex(options: {
  method: string,
  originalUrl?: URL,
  url: URL,
  headers: Headers,
  body: Uint8Array,
}): Promise<[IncomingMessage, ServerResponseWithBodyChunks]> {
  // See https://github.com/nodejs/node/blob/main/lib/_http_incoming.js
  // and https://github.com/nodejs/node/blob/main/lib/_http_common.js (particularly the `parserXyz` functions)

  const incomingMessage = new IncomingMessage({
    encrypted: options.originalUrl?.protocol === "https:",  // trick frameworks into believing this is an HTTPS request
  } as any);
  incomingMessage.httpVersionMajor = 1;
  incomingMessage.httpVersionMinor = 1;
  incomingMessage.httpVersion = '1.1';
  incomingMessage.method = options.method;
  incomingMessage.url = getRelativePart(options.url);
  (incomingMessage as any).originalUrl = options.originalUrl && getRelativePart(options.originalUrl);  // originalUrl is an extension used by some servers; for example, oidc-provider reads it to construct the paths for the .well-known/openid-configuration
  const rawHeaders = [...options.headers.entries()].flat();
  (incomingMessage as any)._addHeaderLines(rawHeaders, rawHeaders.length);
  incomingMessage.push(Buffer.from(options.body));
  incomingMessage.complete = true;
  incomingMessage.push(null);  // to emit end event, see: https://github.com/nodejs/node/blob/4cf6fabce20eb3050c5b543d249e931ea3d3cad5/lib/_http_common.js#L150

  const serverResponse = new ServerResponseWithBodyChunks(incomingMessage);

  return [incomingMessage, serverResponse];
}

const REDIRECT_STATUS_CONVENTION_REMAP: Record<number, number> = {
  301: 308,
  302: 307,
};

export async function dispatchToNodeHttpHandler(
  handler: (req: IncomingMessage, res: ServerResponse) => unknown,
  options: {
    method: string,
    originalUrl?: URL,
    url: URL,
    headers: Headers,
    body: Uint8Array,
    /** Return false to drop a response header. Called once per header value (multi-value headers like set-cookie are split). */
    filterResponseHeader?: (name: string, value: string) => boolean,
  },
): Promise<Response> {
  const [incomingMessage, serverResponse] = await createNodeHttpServerDuplex(options);

  await handler(incomingMessage, serverResponse);

  const body = new Uint8Array(serverResponse.bodyChunks.flatMap(chunk => [...chunk]));
  const headers: [string, string][] = [];
  for (const [name, value] of Object.entries(serverResponse.getHeaders())) {
    for (const item of Array.isArray(value) ? value : [value]) {
      const headerValue = `${item}`;
      if (options.filterResponseHeader && !options.filterResponseHeader(name, headerValue)) continue;
      headers.push([name, headerValue]);
    }
  }
  return new Response(body, {
    headers,
    status: REDIRECT_STATUS_CONVENTION_REMAP[serverResponse.statusCode] ?? serverResponse.statusCode,
    statusText: serverResponse.statusMessage,
  });
}
