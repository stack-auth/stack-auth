import type { ResponseCookieOptions } from "@/lib/runtime/request-context";
import { getNodeEnvironment } from "@hexclave/shared/dist/utils/env";

const TV_DISPLAY_REFRESH_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
const TV_DISPLAY_REFRESH_COOKIE_PATHS = [
  "/api/latest/tv-displays",
  "/api/v1/tv-displays",
] as const;
const LEGACY_TV_DISPLAY_REFRESH_COOKIE_PATH = "/api";

type TvDisplayRefreshCookieStore = {
  set: (name: string, value: string, options: ResponseCookieOptions) => void,
};

function baseTvDisplayRefreshCookieOptions(path: string): ResponseCookieOptions {
  return {
    httpOnly: true,
    secure: getNodeEnvironment() !== "development" && getNodeEnvironment() !== "test",
    sameSite: "strict",
    path,
  };
}

function tvDisplayRefreshCookieOptions(path: string): ResponseCookieOptions {
  return {
    ...baseTvDisplayRefreshCookieOptions(path),
    maxAge: TV_DISPLAY_REFRESH_MAX_AGE_SECONDS,
  };
}

function clearedTvDisplayRefreshCookieOptions(path: string): ResponseCookieOptions {
  return {
    ...baseTvDisplayRefreshCookieOptions(path),
    expires: new Date(0),
    maxAge: 0,
  };
}

export function setTvDisplayRefreshCookie(
  cookieStore: TvDisplayRefreshCookieStore,
  cookieName: string,
  refreshToken: string,
): void {
  // Remove the broad path used by the first implementation during rollout,
  // then issue one narrow cookie for each supported public API alias.
  cookieStore.set(cookieName, "", clearedTvDisplayRefreshCookieOptions(LEGACY_TV_DISPLAY_REFRESH_COOKIE_PATH));
  for (const path of TV_DISPLAY_REFRESH_COOKIE_PATHS) {
    cookieStore.set(cookieName, refreshToken, tvDisplayRefreshCookieOptions(path));
  }
}

export function clearTvDisplayRefreshCookie(
  cookieStore: TvDisplayRefreshCookieStore,
  cookieName: string,
): void {
  for (const path of [...TV_DISPLAY_REFRESH_COOKIE_PATHS, LEGACY_TV_DISPLAY_REFRESH_COOKIE_PATH]) {
    cookieStore.set(cookieName, "", clearedTvDisplayRefreshCookieOptions(path));
  }
}
