export class NextRequest extends Request {
  get nextUrl() {
    return new NextURL(this.url);
  }
}

export class NextURL extends URL {
  clone() {
    return new NextURL(this.toString());
  }
}

export class NextResponse extends Response {
  static json(body: unknown, init?: ResponseInit) {
    const headers = new Headers(init?.headers);
    if (!headers.has("content-type")) {
      headers.set("content-type", "application/json");
    }
    return new NextResponse(JSON.stringify(body), {
      ...init,
      headers,
    });
  }

  static rewrite(url: URL | string, init?: ResponseInit) {
    const headers = new Headers(init?.headers);
    headers.set("x-middleware-rewrite", url.toString());
    return new NextResponse(null, {
      ...init,
      headers,
    });
  }
}

export async function connection() {
  return undefined;
}
