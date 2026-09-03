import { describe, expect, it } from "vitest";
import { toDestinationValues } from "./values";

describe("Convex document values", () => {
  it("turns _creationTime into a timestamp ClickHouse will accept", () => {
    // Convex sends milliseconds since the epoch as a *float*. Written straight
    // into DateTime64(3), ClickHouse reads the integer part and then rejects the
    // whole batch on the fraction — which is how this was found.
    const values = toDestinationValues({ _creationTime: 1788368196628.201 });

    expect(values._creationTime).toBe("2026-09-02T16:56:36.628Z");
  });

  it("leaves a _creationTime it cannot read alone rather than inventing one", () => {
    expect(toDestinationValues({ _creationTime: "already-a-string" })._creationTime).toBe("already-a-string");
    expect(toDestinationValues({ _creationTime: Number.NaN })._creationTime).toBeNaN();
  });

  it("unwraps Convex's bytes encoding to the base64 payload", () => {
    // The generic row builder would JSON-stringify the wrapper into the String
    // column, leaving the customer to unwrap `{"$bytes":"..."}` themselves.
    const values = toDestinationValues({ blob: { $bytes: "aGVsbG8=" } });

    expect(values.blob).toBe("aGVsbG8=");
  });

  it("leaves ordinary nested values for the row builder to encode as JSON", () => {
    const values = toDestinationValues({ meta: { rank: 1 }, tags: ["a", "b"] });

    expect(values.meta).toEqual({ rank: 1 });
    expect(values.tags).toEqual(["a", "b"]);
  });

  it("does not mistake a nested object for a bytes wrapper", () => {
    // Convex forbids document field names starting with `$`, so a real document
    // cannot contain this — but an object that merely has other keys must not be
    // collapsed to one of them.
    const values = toDestinationValues({ meta: { $bytes: "x", other: 1 } });

    expect(values.meta).toEqual({ $bytes: "x", other: 1 });
  });

  it("passes scalars and null through untouched", () => {
    const values = toDestinationValues({ name: "ada", age: 36, active: true, missing: null });

    expect(values).toEqual({ name: "ada", age: 36, active: true, missing: null });
  });

  it("preserves a field named __proto__ as an own property", () => {
    // Built with fromEntries, because `{ __proto__: ... }` in a literal is a
    // prototype setter rather than a field — the same trap this guards against.
    const document = Object.fromEntries([["__proto__", "not-a-prototype"]]) as Record<string, unknown>;

    const values = toDestinationValues(document);

    expect(Object.hasOwn(values, "__proto__")).toBe(true);
    expect(values["__proto__"]).toBe("not-a-prototype");
  });
});
