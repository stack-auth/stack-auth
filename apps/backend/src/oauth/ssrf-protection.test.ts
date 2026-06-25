import { StatusError } from "@hexclave/shared/dist/utils/errors";
import { describe, expect, it } from "vitest";
import { assertSafeOAuthResolvedAddress, assertSafeOAuthUrlWithoutDns, isBlockedOAuthIpAddress } from "./ssrf-protection";

describe("isBlockedOAuthIpAddress", () => {
  it("blocks AWS metadata, loopback, and private IPv4 ranges", () => {
    expect(isBlockedOAuthIpAddress("169.254.169.254")).toBe(true);
    expect(isBlockedOAuthIpAddress("127.0.0.1")).toBe(true);
    expect(isBlockedOAuthIpAddress("10.0.0.8")).toBe(true);
    expect(isBlockedOAuthIpAddress("172.16.0.1")).toBe(true);
    expect(isBlockedOAuthIpAddress("192.168.1.1")).toBe(true);
  });

  it("blocks local and private IPv6 ranges", () => {
    expect(isBlockedOAuthIpAddress("::1")).toBe(true);
    expect(isBlockedOAuthIpAddress("[::1]")).toBe(true);
    expect(isBlockedOAuthIpAddress("fe80::1")).toBe(true);
    expect(isBlockedOAuthIpAddress("fc00::1")).toBe(true);
  });

  it("blocks IPv4-mapped IPv6 internal addresses", () => {
    expect(isBlockedOAuthIpAddress("::ffff:127.0.0.1")).toBe(true);
    expect(isBlockedOAuthIpAddress("::ffff:169.254.169.254")).toBe(true);
  });

  it("allows public IP addresses", () => {
    expect(isBlockedOAuthIpAddress("8.8.8.8")).toBe(false);
    expect(isBlockedOAuthIpAddress("2001:4860:4860::8888")).toBe(false);
  });
});

describe("assertSafeOAuthUrlWithoutDns", () => {
  it("requires HTTPS", () => {
    expect(() => assertSafeOAuthUrlWithoutDns("http://accounts.example.com")).toThrow(StatusError);
  });

  it("blocks IP-literal internal hosts", () => {
    expect(() => assertSafeOAuthUrlWithoutDns("https://169.254.169.254/latest/meta-data/")).toThrow(StatusError);
    expect(() => assertSafeOAuthUrlWithoutDns("https://[::1]/.well-known/openid-configuration")).toThrow(StatusError);
  });

  it("allows public HTTPS URLs before DNS resolution", () => {
    expect(assertSafeOAuthUrlWithoutDns("https://accounts.google.com").hostname).toBe("accounts.google.com");
  });
});

describe("assertSafeOAuthResolvedAddress", () => {
  it("rejects DNS results that resolve to internal addresses", () => {
    expect(() => assertSafeOAuthResolvedAddress("192.168.0.10")).toThrow(StatusError);
  });
});

