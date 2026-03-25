import { describe, expect, it } from "vitest";
import { tokenStoreFromHeaders } from "./common";

describe("tokenStoreFromHeaders", () => {
  it("reads x-stack-auth from Fetch Headers", () => {
    const tokenStore = tokenStoreFromHeaders(new Headers({
      "x-stack-auth": '{"accessToken":"access","refreshToken":"refresh"}',
    }));

    expect(tokenStore.headers.get("x-stack-auth")).toBe('{"accessToken":"access","refreshToken":"refresh"}');
  });

  it("reads headers case-insensitively from Node-style header objects", () => {
    const tokenStore = tokenStoreFromHeaders({
      "X-Stack-Auth": '{"accessToken":"access","refreshToken":"refresh"}',
    });

    expect(tokenStore.headers.get("x-stack-auth")).toBe('{"accessToken":"access","refreshToken":"refresh"}');
    expect(tokenStore.headers.get("X-Stack-Auth")).toBe('{"accessToken":"access","refreshToken":"refresh"}');
  });

  it("joins array-valued cookie headers", () => {
    const tokenStore = tokenStoreFromHeaders({
      cookie: ["foo=bar", "baz=qux"],
    });

    expect(tokenStore.headers.get("cookie")).toBe("foo=bar; baz=qux");
  });

  it("uses the first value for non-cookie header arrays", () => {
    const tokenStore = tokenStoreFromHeaders({
      "x-stack-auth": [
        '{"accessToken":"first","refreshToken":"refresh"}',
        '{"accessToken":"second","refreshToken":"refresh"}',
      ],
    });

    expect(tokenStore.headers.get("x-stack-auth")).toBe('{"accessToken":"first","refreshToken":"refresh"}');
  });
});
