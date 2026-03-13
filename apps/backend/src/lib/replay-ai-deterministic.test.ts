import { describe, expect, it } from "vitest";
import { analyzeReplayDeterministically, type ReplayTimelineEvent } from "./replay-ai-deterministic";

function event(eventType: string, eventAtMs: number, data: Record<string, unknown>): ReplayTimelineEvent {
  return { eventType, eventAtMs, data };
}

describe("replay-ai-deterministic", () => {
  it("prefers explicit frontend errors over weaker friction signals", () => {
    const result = analyzeReplayDeterministically({
      startedAtMs: 1_000,
      lastEventAtMs: 12_000,
      timelineEvents: [
        event("$page-view", 1_000, { path: "/sign-in" }),
        event("$click", 2_000, { selector: "button.primary" }),
        event("$error", 2_500, { message: "Cannot read properties of undefined" }),
      ],
    });

    expect(result).toMatchInlineSnapshot(`
      {
        "confidence": 0.95,
        "evidence": [
          {
            "end_offset_ms": 3000,
            "event_type": "$error",
            "label": "Application error",
            "reason": "Cannot read properties of undefined",
            "start_offset_ms": 500,
          },
        ],
        "fingerprint": "frontend-error:/sign-in",
        "issueTitle": "Frontend error surfaced during replay",
        "severity": "high",
        "summary": "This replay shows friction on /sign-in. Cannot read properties of undefined",
        "visualArtifacts": [
          {
            "alt_text": "Application error: Cannot read properties of undefined",
            "data_url": null,
            "display_name": "Application error",
            "id": "artifact-1",
            "kind": "timeline-card",
            "mime_type": null,
            "start_offset_ms": 500,
          },
        ],
        "whyLikely": "A browser error event was captured directly from the session timeline, so this replay likely reflects a real user-facing failure rather than inferred friction.",
      }
    `);
  });

  it("detects rage clicks on the same selector", () => {
    const result = analyzeReplayDeterministically({
      startedAtMs: 10_000,
      lastEventAtMs: 25_000,
      timelineEvents: [
        event("$page-view", 10_000, { path: "/settings" }),
        event("$click", 12_000, { selector: "button.save" }),
        event("$click", 13_000, { selector: "button.save" }),
        event("$click", 14_500, { selector: "button.save" }),
      ],
    });

    expect(result.fingerprint).toBe("rage-click:/settings");
    expect(result.evidence[0]?.reason).toContain("clicked 3 times");
  });

  it("detects form abandonment when inputs are never submitted", () => {
    const result = analyzeReplayDeterministically({
      startedAtMs: 50_000,
      lastEventAtMs: 95_000,
      timelineEvents: [
        event("$page-view", 50_000, { path: "/checkout" }),
        event("$input", 60_000, { selector: "input[name=email]" }),
        event("$input", 61_000, { selector: "input[name=card]" }),
      ],
    });

    expect(result.fingerprint).toBe("form-abandonment:/checkout");
    expect(result.issueTitle).toBe("User abandoned a form before submitting");
  });
});
