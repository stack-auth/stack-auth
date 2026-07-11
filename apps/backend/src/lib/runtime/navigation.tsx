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

export class NextNotFoundError extends Error {
  digest = "NEXT_NOT_FOUND";

  constructor() {
    super("NEXT_NOT_FOUND");
  }
}

export const RedirectType = {
  push: "push",
  replace: "replace",
} as const;

export function redirect(url: string, _type?: typeof RedirectType[keyof typeof RedirectType]): never {
  throw new NextRedirectError(url, 307);
}

export function permanentRedirect(url: string): never {
  throw new NextRedirectError(url, 308);
}

export function notFound(): never {
  throw new NextNotFoundError();
}

export function usePathname(): never {
  throw new Error("next/navigation usePathname() was called in the backend runtime");
}

export function useSearchParams(): never {
  throw new Error("next/navigation useSearchParams() was called in the backend runtime");
}
