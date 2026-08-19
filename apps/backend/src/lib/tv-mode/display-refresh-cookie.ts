import type { ResponseCookieOptions } from "@/lib/runtime/request-context";
import { getNodeEnvironment } from "@hexclave/shared/dist/utils/env";

const TV_DISPLAY_REFRESH_MAX_AGE_SECONDS = 90 * 24 * 60 * 60;

function baseTvDisplayRefreshCookieOptions(): ResponseCookieOptions {
  return {
    httpOnly: true,
    secure: getNodeEnvironment() !== "development" && getNodeEnvironment() !== "test",
    sameSite: "strict",
    path: "/api/latest/tv-displays",
  };
}

export function tvDisplayRefreshCookieOptions(): ResponseCookieOptions {
  return {
    ...baseTvDisplayRefreshCookieOptions(),
    maxAge: TV_DISPLAY_REFRESH_MAX_AGE_SECONDS,
  };
}

export function clearedTvDisplayRefreshCookieOptions(): ResponseCookieOptions {
  return {
    ...baseTvDisplayRefreshCookieOptions(),
    expires: new Date(0),
    maxAge: 0,
  };
}
