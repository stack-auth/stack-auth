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
