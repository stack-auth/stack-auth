import { describe, expect, it } from "vitest";
import { isAppleEmailVerified } from "./utils";

describe("isAppleEmailVerified", () => {
  it("treats the boolean true as verified", () => {
    expect(isAppleEmailVerified(true)).toBe(true);
  });

  it("treats the string \"true\" as verified", () => {
    expect(isAppleEmailVerified("true")).toBe(true);
  });

  it("treats the boolean false as unverified", () => {
    expect(isAppleEmailVerified(false)).toBe(false);
  });

  // Regression: a naive `!!value` coerces the string "false" to `true`, which
  // would let an unverified Apple email pass the account-merge verification gate.
  it("treats the string \"false\" as unverified", () => {
    expect(isAppleEmailVerified("false")).toBe(false);
  });

  it("treats missing/empty/other values as unverified", () => {
    expect(isAppleEmailVerified(undefined)).toBe(false);
    expect(isAppleEmailVerified(null)).toBe(false);
    expect(isAppleEmailVerified("")).toBe(false);
    expect(isAppleEmailVerified("True")).toBe(false);
    expect(isAppleEmailVerified("1")).toBe(false);
    expect(isAppleEmailVerified(1)).toBe(false);
  });
});
