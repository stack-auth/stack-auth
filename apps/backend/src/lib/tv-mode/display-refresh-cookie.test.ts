import { describe, expect, it, vi } from "vitest";
import {
  clearTvDisplayRefreshCookie,
  setTvDisplayRefreshCookie,
} from "./display-refresh-cookie";

describe("TV display refresh cookie policy", () => {
  it("issues alias-scoped credentials while clearing the legacy broad cookie", () => {
    const set = vi.fn();
    setTvDisplayRefreshCookie({ set }, "tv-refresh", "secret");

    expect(set.mock.calls).toEqual([
      ["tv-refresh", "", expect.objectContaining({ path: "/api", expires: new Date(0), maxAge: 0 })],
      ["tv-refresh", "secret", expect.objectContaining({ path: "/api/latest/tv-displays", maxAge: 90 * 24 * 60 * 60 })],
      ["tv-refresh", "secret", expect.objectContaining({ path: "/api/v1/tv-displays", maxAge: 90 * 24 * 60 * 60 })],
    ]);
    for (const [, , options] of set.mock.calls) {
      expect(options).toEqual(expect.objectContaining({ httpOnly: true, secure: false, sameSite: "strict" }));
    }
  });

  it("clears both supported aliases and the legacy broad scope", () => {
    const set = vi.fn();
    clearTvDisplayRefreshCookie({ set }, "tv-refresh");

    expect(set.mock.calls.map(([, , options]) => options.path)).toEqual([
      "/api/latest/tv-displays",
      "/api/v1/tv-displays",
      "/api",
    ]);
    for (const [name, value, options] of set.mock.calls) {
      expect({ name, value, options }).toEqual({
        name: "tv-refresh",
        value: "",
        options: expect.objectContaining({ expires: new Date(0), maxAge: 0 }),
      });
    }
  });
});
