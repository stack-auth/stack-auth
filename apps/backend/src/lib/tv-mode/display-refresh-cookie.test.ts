import { describe, expect, it } from "vitest";
import {
  clearedTvDisplayRefreshCookieOptions,
  tvDisplayRefreshCookieOptions,
} from "./display-refresh-cookie";

describe("TV display refresh cookie policy", () => {
  it("keeps issuance and clearing on the same secure cookie scope", () => {
    expect(tvDisplayRefreshCookieOptions()).toEqual({
      httpOnly: true,
      secure: false,
      sameSite: "strict",
      path: "/api",
      maxAge: 90 * 24 * 60 * 60,
    });
    expect(clearedTvDisplayRefreshCookieOptions()).toEqual({
      httpOnly: true,
      secure: false,
      sameSite: "strict",
      path: "/api",
      expires: new Date(0),
      maxAge: 0,
    });
  });
});
