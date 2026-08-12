export class NextRedirectError extends Error {
  digest = "NEXT_REDIRECT";
  redirectUrl: string;
  redirectStatus: 307 | 308;

  constructor(url: string, status: 307 | 308) {
    super("NEXT_REDIRECT");
    this.redirectUrl = url;
    this.redirectStatus = status;
  }
}

export function redirect(url: string): never {
  throw new NextRedirectError(url, 307);
}
