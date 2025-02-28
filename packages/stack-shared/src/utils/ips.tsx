import ipRegex from "ip-regex";

export type Ipv4Address = `${number}.${number}.${number}.${number}`;
export type Ipv6Address = string;

export function isIpAddress(ip: string): ip is Ipv4Address | Ipv6Address {
  return ipRegex({ exact: true }).test(ip);
}
import.meta.vitest?.test("isIpAddress", ({ expect }) => {
  // Test valid IPv4 addresses
  expect(isIpAddress("192.168.1.1")).toBe(true);
  expect(isIpAddress("127.0.0.1")).toBe(true);
  expect(isIpAddress("0.0.0.0")).toBe(true);
  expect(isIpAddress("255.255.255.255")).toBe(true);

  // Test valid IPv6 addresses
  expect(isIpAddress("::1")).toBe(true);
  expect(isIpAddress("2001:db8::")).toBe(true);
  expect(isIpAddress("2001:db8:85a3:8d3:1319:8a2e:370:7348")).toBe(true);

  // Test invalid IP addresses
  expect(isIpAddress("")).toBe(false);
  expect(isIpAddress("not an ip")).toBe(false);
  expect(isIpAddress("256.256.256.256")).toBe(false);
  expect(isIpAddress("192.168.1")).toBe(false);
  expect(isIpAddress("192.168.1.1.1")).toBe(false);
  expect(isIpAddress("2001:db8::xyz")).toBe(false);
});

export function assertIpAddress(ip: string): asserts ip is Ipv4Address | Ipv6Address {
  if (!isIpAddress(ip)) {
    throw new Error(`Invalid IP address: ${ip}`);
  }
}
import.meta.vitest?.test("assertIpAddress", ({ expect }) => {
  // Test with valid IPv4 address
  expect(() => assertIpAddress("192.168.1.1")).not.toThrow();

  // Test with valid IPv6 address
  expect(() => assertIpAddress("::1")).not.toThrow();

  // Test with invalid IP addresses
  expect(() => assertIpAddress("")).toThrow("Invalid IP address: ");
  expect(() => assertIpAddress("not an ip")).toThrow("Invalid IP address: not an ip");
  expect(() => assertIpAddress("256.256.256.256")).toThrow("Invalid IP address: 256.256.256.256");
  expect(() => assertIpAddress("192.168.1")).toThrow("Invalid IP address: 192.168.1");
});
