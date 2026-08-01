import { generateW3cSpanId, generateW3cTraceId, isW3cTraceId } from "@hexclave/shared/dist/utils/analytics-wire";
import { afterEach, describe, expect, it, vi } from "vitest";
import { autoDetectedBackgroundTaskHook, resolveSpanParent, type ResolvedSpanParent, type Span, type SpanContext } from "./telemetry-core";

const VERCEL_REQUEST_CONTEXT_SYMBOL = Symbol.for("@vercel/request-context");

describe("autoDetectedBackgroundTaskHook (Vercel waitUntil auto-wiring)", () => {
  afterEach(() => {
    // Symbol keys are not covered by vi.unstubAllGlobals(), so clean up by hand.
    delete (globalThis as Record<symbol, unknown>)[VERCEL_REQUEST_CONTEXT_SYMBOL];
    vi.restoreAllMocks();
  });

  it("hands the promise to the active Vercel request context's waitUntil", () => {
    const waitUntil = vi.fn();
    (globalThis as Record<symbol, unknown>)[VERCEL_REQUEST_CONTEXT_SYMBOL] = {
      get: () => ({ waitUntil }),
    };
    const promise = Promise.resolve();
    autoDetectedBackgroundTaskHook(promise);
    expect(waitUntil).toHaveBeenCalledTimes(1);
    expect(waitUntil).toHaveBeenCalledWith(promise);
  });

  it("looks the context up PER CALL (request-scoped, never cached)", () => {
    const first = vi.fn();
    const second = vi.fn();
    const holder = { get: () => ({ waitUntil: first }) };
    (globalThis as Record<symbol, unknown>)[VERCEL_REQUEST_CONTEXT_SYMBOL] = holder;
    autoDetectedBackgroundTaskHook(Promise.resolve());
    holder.get = () => ({ waitUntil: second });
    autoDetectedBackgroundTaskHook(Promise.resolve());
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("is a no-op off Vercel and degrades to a no-op on any shape mismatch", () => {
    // No symbol at all.
    expect(() => autoDetectedBackgroundTaskHook(Promise.resolve())).not.toThrow();
    // Holder without get.
    (globalThis as Record<symbol, unknown>)[VERCEL_REQUEST_CONTEXT_SYMBOL] = {};
    expect(() => autoDetectedBackgroundTaskHook(Promise.resolve())).not.toThrow();
    // Throwing get.
    (globalThis as Record<symbol, unknown>)[VERCEL_REQUEST_CONTEXT_SYMBOL] = {
      get: () => {
        throw new Error("no active request");
      },
    };
    expect(() => autoDetectedBackgroundTaskHook(Promise.resolve())).not.toThrow();
    // Context without waitUntil.
    (globalThis as Record<symbol, unknown>)[VERCEL_REQUEST_CONTEXT_SYMBOL] = { get: () => ({}) };
    expect(() => autoDetectedBackgroundTaskHook(Promise.resolve())).not.toThrow();
  });
});

/**
 * `resolveSpanParent` is the single decision point for where any new span or
 * event sits in the trace graph — every tier (browser tracker, server app,
 * inert handles, the OTel bridge seam) routes through it, so these are the
 * tests that pin the W3C parenting rules themselves rather than one caller's
 * plumbing.
 */
describe("resolveSpanParent", () => {
  function ctx(traceId: string = generateW3cTraceId()): SpanContext {
    return { traceId, spanId: generateW3cSpanId() };
  }

  /** Narrows off the `{ error }` branch so tests read as assertions, not casts. */
  function resolved(result: ResolvedSpanParent | { error: string }): ResolvedSpanParent {
    if ("error" in result) throw new Error(`expected a resolved parent, got error: ${result.error}`);
    return result;
  }

  it("with nothing at all, mints a fresh trace rooted at the new item", () => {
    const first = resolved(resolveSpanParent({}));
    expect(first.parentSpanId).toBeNull();
    expect(isW3cTraceId(first.traceId)).toBe(true);
    // A fresh trace per call — two unrelated root activities must never collide.
    expect(resolved(resolveSpanParent({})).traceId).not.toBe(first.traceId);
  });

  it("takes the NEAREST (last) ambient context as parent — ordering is outermost-first", () => {
    const outer = ctx();
    const inner = ctx(outer.traceId);
    expect(resolved(resolveSpanParent({ ambient: [outer, inner] }))).toEqual({
      traceId: outer.traceId,
      parentSpanId: inner.spanId,
      links: [],
    });
  });

  it("an explicit parent beats ambient entirely (a span has exactly one parent)", () => {
    const ambient = ctx();
    const explicit = ctx();
    const result = resolved(resolveSpanParent({ explicit, ambient: [ambient] }));
    expect(result.traceId).toBe(explicit.traceId);
    expect(result.parentSpanId).toBe(explicit.spanId);
    // The ambient span was NOT merged in as an extra ancestor — it is in another
    // trace, so it is recorded as a link instead of being silently discarded.
    expect(result.links).toEqual([ambient]);
  });

  it("accepts a live Span handle as a parent, reading its spanContext()", () => {
    const context = ctx();
    // Only spanContext() is exercised, so a minimal stand-in is enough here and
    // keeps this a unit test of the resolver rather than of the handle kit.
    const handle: Pick<Span, "spanContext"> = { spanContext: () => context };
    expect(resolved(resolveSpanParent({ explicit: handle as Span }))).toEqual({
      traceId: context.traceId,
      parentSpanId: context.spanId,
      links: [],
    });
  });

  it("root:true drops ambient and mints a NEW trace with a null parent", () => {
    const ambient = ctx();
    const result = resolved(resolveSpanParent({ ambient: [ambient], root: true }));
    expect(result.parentSpanId).toBeNull();
    expect(result.traceId).not.toBe(ambient.traceId);
    expect(isW3cTraceId(result.traceId)).toBe(true);
    // `root` drops ambient outright, so there is nothing left to link either —
    // a root activity is deliberately detached, not "detached but cross-linked".
    expect(result.links).toEqual([]);
  });

  it("root:true still yields to an explicit parent (root only drops the AMBIENT one)", () => {
    const explicit = ctx();
    expect(resolved(resolveSpanParent({ explicit, ambient: [ctx()], root: true }))).toEqual({
      traceId: explicit.traceId,
      parentSpanId: explicit.spanId,
      links: [],
    });
  });

  it("demotes only DIFFERENT-trace ambient contexts to links; same-trace ones need none", () => {
    const chosenTrace = generateW3cTraceId();
    const sameTraceOuter = ctx(chosenTrace);
    const otherTrace = ctx();
    const nearest = ctx(chosenTrace);
    const result = resolved(resolveSpanParent({ ambient: [sameTraceOuter, otherTrace, nearest] }));
    expect(result.parentSpanId).toBe(nearest.spanId);
    expect(result.traceId).toBe(chosenTrace);
    // `sameTraceOuter` is plausibly an ancestor of the parent already, so
    // linking it would be redundant noise; `otherTrace` provably is not.
    expect(result.links).toEqual([otherTrace]);
  });

  it("keeps caller-declared links verbatim and in order, ahead of any demoted ones", () => {
    const declared = ctx();
    const ambientOther = ctx();
    const result = resolved(resolveSpanParent({ ambient: [ambientOther], links: [declared] }));
    expect(result.parentSpanId).toBe(ambientOther.spanId);
    // The parent's own entry is not linked to itself, and the explicitly
    // declared link survives untouched.
    expect(result.links).toEqual([declared]);
  });

  it("does not re-add a demoted ambient context the caller already declared as a link", () => {
    // Without the dedupe the same span would appear twice in
    // `analytics_internal.span_links`, which readers would render as two
    // distinct relationships to one span.
    const ambientOther = ctx();
    const explicit = ctx();
    const result = resolved(resolveSpanParent({ explicit, ambient: [ambientOther], links: [ambientOther] }));
    expect(result.links).toEqual([ambientOther]);
  });

  it("returns an error (never a silent reparent) for a malformed explicit parent", () => {
    const goodSpanId = generateW3cSpanId();
    const goodTraceId = generateW3cTraceId();
    expect(resolveSpanParent({ explicit: { traceId: "too-short", spanId: goodSpanId } }))
      .toEqual({ error: expect.stringContaining("Invalid parent traceId") });
    // The all-zero ids are structurally 32/16 hex but invalid per the W3C spec,
    // and would break every downstream join if they were let through.
    expect(resolveSpanParent({ explicit: { traceId: "0".repeat(32), spanId: goodSpanId } }))
      .toEqual({ error: expect.stringContaining("not all-zero") });
    expect(resolveSpanParent({ explicit: { traceId: goodTraceId, spanId: "0".repeat(16) } }))
      .toEqual({ error: expect.stringContaining("Invalid parent spanId") });
    // Uppercase hex is rejected too: the wire contract is lowercase, so
    // accepting it would make the same span id compare unequal to itself.
    expect(resolveSpanParent({ explicit: { traceId: goodTraceId.toUpperCase(), spanId: goodSpanId } }))
      .toEqual({ error: expect.stringContaining("Invalid parent traceId") });
  });

  it("returns an error for a malformed AMBIENT context rather than falling back to a new trace", () => {
    // Ambient contexts come from our own live handles, so a bad one means a
    // handle was built with a broken identity — failing loud beats quietly
    // reparenting the caller's span into a brand-new trace.
    expect(resolveSpanParent({ ambient: [{ traceId: "nope", spanId: generateW3cSpanId() }] }))
      .toEqual({ error: expect.stringContaining("Invalid ambient parent traceId") });
  });

  it("returns an error for a malformed link", () => {
    expect(resolveSpanParent({ links: [{ traceId: generateW3cTraceId(), spanId: "nope" }] }))
      .toEqual({ error: expect.stringContaining("Invalid link spanId") });
  });
});
