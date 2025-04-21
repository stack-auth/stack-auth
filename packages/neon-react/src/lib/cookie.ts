
//===========================================
// THIS FILE IS AUTO-GENERATED FROM TEMPLATE. DO NOT EDIT IT DIRECTLY
//===========================================
import { isBrowserLike } from '@stackframe/stack-shared/dist/utils/env';
import { StackAssertionError } from '@stackframe/stack-shared/dist/utils/errors';
import Cookies from "js-cookie";
import { calculatePKCECodeChallenge, generateRandomCodeVerifier, generateRandomState } from "oauth4webapi";

type SetCookieOptions = { maxAge?: number, noOpIfServerComponent?: boolean };
type DeleteCookieOptions = { noOpIfServerComponent?: boolean };

function ensureClient() {
  if (!isBrowserLike()) {
    throw new Error("cookieClient functions can only be called in a browser environment, yet window is undefined");
  }
}

export type CookieHelper = {
  get: (name: string) => string | null,
  set: (name: string, value: string, options: SetCookieOptions) => void,
  setOrDelete: (name: string, value: string | null, options: SetCookieOptions & DeleteCookieOptions) => void,
  delete: (name: string, options: DeleteCookieOptions) => void,
};

const placeholderCookieHelperIdentity = { "placeholder cookie helper identity": true };
export async function createPlaceholderCookieHelper(): Promise<CookieHelper> {
  function throwError(): never {
    throw new StackAssertionError("Throwing cookie helper is just a placeholder. This should never be called");
  }
  return {
    get: throwError,
    set: throwError,
    setOrDelete: throwError,
    delete: throwError,
  };
}

export async function createCookieHelper(): Promise<CookieHelper> {
  if (isBrowserLike()) {
    return createBrowserCookieHelper();
  } else {
    return await createPlaceholderCookieHelper();
  }
}

export function createBrowserCookieHelper(): CookieHelper {
  return {
    get: getCookieClient,
    set: setCookieClient,
    setOrDelete: setOrDeleteCookieClient,
    delete: deleteCookieClient,
  };
}

function handleCookieError(e: unknown, options: DeleteCookieOptions | SetCookieOptions) {
  if (e instanceof Error && e.message.includes("Cookies can only be modified in")) {
    if (options.noOpIfServerComponent) {
      // ignore
    } else {
      throw new StackAssertionError("Attempted to set cookie in server component. Pass { noOpIfServerComponent: true } in the options of Stack's cookie functions if this is intentional and you want to ignore this error. Read more: https://nextjs.org/docs/app/api-reference/functions/cookies#options");
    }
  } else {
    throw e;
  }
}


export function getCookieClient(name: string): string | null {
  ensureClient();
  // set a helper cookie, see comment in `NextCookieHelper.set` above
  Cookies.set("stack-is-https", "true", { secure: true });
  return Cookies.get(name) ?? null;
}

export async function getCookie(name: string): Promise<string | null> {
  const cookieHelper = await createCookieHelper();
  return cookieHelper.get(name);
}

export function setOrDeleteCookieClient(name: string, value: string | null, options: SetCookieOptions & DeleteCookieOptions = {}) {
  ensureClient();
  if (value === null) {
    deleteCookieClient(name, options);
  } else {
    setCookieClient(name, value, options);
  }
}

export async function setOrDeleteCookie(name: string, value: string | null, options: SetCookieOptions & DeleteCookieOptions = {}) {
  const cookieHelper = await createCookieHelper();
  cookieHelper.setOrDelete(name, value, options);
}

export function deleteCookieClient(name: string, options: DeleteCookieOptions = {}) {
  ensureClient();
  Cookies.remove(name);
}

export async function deleteCookie(name: string, options: DeleteCookieOptions = {}) {
  const cookieHelper = await createCookieHelper();
  cookieHelper.delete(name, options);
}

export function setCookieClient(name: string, value: string, options: SetCookieOptions = {}) {
  ensureClient();
  Cookies.set(name, value, {
    expires: options.maxAge === undefined ? undefined : new Date(Date.now() + (options.maxAge) * 1000),
  });
}

export async function setCookie(name: string, value: string, options: SetCookieOptions = {}) {
  const cookieHelper = await createCookieHelper();
  cookieHelper.set(name, value, options);
}

export async function saveVerifierAndState() {
  const codeVerifier = generateRandomCodeVerifier();
  const codeChallenge = await calculatePKCECodeChallenge(codeVerifier);
  const state = generateRandomState();

  await setCookie("stack-oauth-outer-" + state, codeVerifier, { maxAge: 60 * 60 });

  return {
    codeChallenge,
    state,
  };
}

export function consumeVerifierAndStateCookie(state: string) {
  ensureClient();
  const cookieName = "stack-oauth-outer-" + state;
  const codeVerifier = getCookieClient(cookieName);
  if (!codeVerifier) {
    return null;
  }
  deleteCookieClient(cookieName);
  return {
    codeVerifier,
  };
}
