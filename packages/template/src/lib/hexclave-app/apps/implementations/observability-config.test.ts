import { describe, expect, it } from "vitest";
import { normalizeTraceSampleRate, observabilityOptionsToJson } from "./observability-config";

describe("normalizeTraceSampleRate", () => {
  it("defaults to 10% root trace sampling", () => {
    expect(normalizeTraceSampleRate(undefined)).toBe(0.1);
  });

  it("accepts the top-level trace rate and the deprecated network alias", () => {
    expect(normalizeTraceSampleRate({ traceSampleRate: 0.1 })).toBe(0.1);
    expect(normalizeTraceSampleRate({ traceSampleRate: 0.25 })).toBe(0.25);
  });

  it("rejects invalid or conflicting rates at app construction", () => {
    expect(() => normalizeTraceSampleRate({ traceSampleRate: -0.1 })).toThrow(/between 0 and 1/);
    expect(() => normalizeTraceSampleRate({ traceSampleRate: Number.NaN })).toThrow(/between 0 and 1/);
  });
});

describe("observabilityOptionsToJson", () => {
  it("omits runtime processor callbacks from the SSR payload", () => {
    const beforeSend = () => null;
    const eventProcessor = () => null;
    expect(observabilityOptionsToJson({
      enabled: true,
      errorCapture: {
        enabled: true,
        ignoreErrors: ["fixture"],
        eventProcessors: [eventProcessor],
        beforeSend,
      },
    })).toEqual({
      enabled: true,
      errorCapture: {
        enabled: true,
        ignoreErrors: ["fixture"],
      },
    });
  });

  it("omits attachment delivery callbacks from the SSR payload", () => {
    const attachmentTransport = {
      upload: async () => {
        throw new Error("fixture");
      },
    };
    const onAttachmentPending = () => undefined;
    expect(observabilityOptionsToJson({
      errorCapture: { attachmentTransport, onAttachmentPending },
    })).toEqual({ errorCapture: {} });
  });
});
