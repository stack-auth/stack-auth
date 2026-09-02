import { describe, expect, it } from "vitest";
import { parseJsonPreservingBigIntegers, toBigInt } from "./json";

describe("parsing Convex responses without losing precision", () => {
  it("keeps a nanosecond version timestamp exact", () => {
    // Taken from a real /api/v1/data/sync response. JSON.parse turns this into
    // 1788367987801278000 — the version column would then be wrong by 134ns.
    const text = '{"ts":1788367987801277866}';

    // Compared as text, because writing the number as a literal here would round
    // it in exactly the same way and the assertion would pass for nothing.
    expect(String(JSON.parse(text).ts)).toBe("1788367987801278000");
    expect((parseJsonPreservingBigIntegers(text) as { ts: string }).ts).toBe("1788367987801277866");
  });

  it("keeps two versions from the same instant distinct and ordered", () => {
    // The failure this guards against is not an inaccurate number, it is two
    // versions collapsing onto one. At Convex's magnitude the representable
    // doubles are 256ns apart, so an update and the delete that follows it can
    // easily land on the same value — and ReplacingMergeTree then keeps
    // whichever row it likes rather than the later one.
    const earlier = "1788367987801277866";
    const later = "1788367987801277900";

    expect(JSON.parse(earlier)).toBe(JSON.parse(later));

    const parsed = parseJsonPreservingBigIntegers(`[{"ts":${earlier}},{"ts":${later}}]`) as { ts: string }[];
    expect(BigInt(parsed[0].ts) < BigInt(parsed[1].ts)).toBe(true);
  });

  it("leaves floats alone, so _creationTime stays a number", () => {
    const parsed = parseJsonPreservingBigIntegers('{"_creationTime":1788367966967.3257}') as { _creationTime: number };
    expect(parsed._creationTime).toBe(1788367966967.3257);
  });

  it("leaves safe integers as numbers", () => {
    expect(parseJsonPreservingBigIntegers('{"a":42,"b":-7,"c":0}')).toEqual({ a: 42, b: -7, c: 0 });
  });

  it("does not rewrite digits inside strings", () => {
    // The rewrite is a text transform, so a document whose *content* looks like a
    // large number must come through untouched — including one that contains a
    // quote or a backslash right before it.
    const parsed = parseJsonPreservingBigIntegers(
      '{"a":"1788367987801277866","b":"say \\"1788367987801277866\\"","c":"back\\\\slash"}',
    );
    expect(parsed).toEqual({
      a: "1788367987801277866",
      b: 'say "1788367987801277866"',
      c: "back\\slash",
    });
  });

  it("handles exponent notation without quoting it", () => {
    expect(parseJsonPreservingBigIntegers('{"a":1e21,"b":-2.5e-3}')).toEqual({ a: 1e21, b: -2.5e-3 });
  });

  it("protects a customer's own Int64 field, not just the version", () => {
    const parsed = parseJsonPreservingBigIntegers(
      '{"value":{"_id":"abc","big":9223372036854775807}}',
    ) as { value: { big: string } };
    expect(parsed.value.big).toBe("9223372036854775807");
  });

  it("parses a whole sync page the way the driver reads it", () => {
    const page = parseJsonPreservingBigIntegers(
      '{"status":{"type":"upToDate","snapshotTs":1788367987824994293},"truncates":[],'
      + '"values":[{"component":"","table":"users","ts":1788367987801277866,"deleted":false,'
      + '"value":{"_creationTime":1788367966934.7974,"_id":"jd7f","age":99.0,"name":"ada"}}],'
      + '"pagination":{"hasMore":true,"nextCursor":"0108"}}',
    ) as any;

    expect(toBigInt(page.values[0].ts, "ts")).toBe(1788367987801277866n);
    expect(page.values[0].value.name).toBe("ada");
    expect(page.values[0].value._creationTime).toBe(1788367966934.7974);
    expect(page.pagination.nextCursor).toBe("0108");
  });
});

describe("toBigInt", () => {
  it("accepts both representations an integer can arrive in", () => {
    expect(toBigInt("1788367987801277866", "ts")).toBe(1788367987801277866n);
    expect(toBigInt(42, "ts")).toBe(42n);
  });

  it("refuses anything it cannot order", () => {
    expect(() => toBigInt(1.5, "ts")).toThrow("not an integer");
    expect(() => toBigInt(null, "ts")).toThrow("not an integer");
    expect(() => toBigInt("abc", "ts")).toThrow("not an integer");
  });
});
