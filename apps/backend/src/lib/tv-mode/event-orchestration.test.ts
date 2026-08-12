import { describe, expect, it } from "vitest";
import { getTvBuiltInProfile } from "@hexclave/shared/dist/interface/admin-tv-mode";
import {
  createTvPresentationAssignment,
  deriveTvPresentation,
  type TvDurableEventOccurrence,
} from "./event-orchestration";

function preferences() {
  const profile = getTvBuiltInProfile("company-pulse");
  if (profile == null) throw new Error("Company Pulse must exist");
  return profile.configuration.interruptionPreferences;
}

const occurredAt = new Date("2026-07-29T10:00:00.000Z");

function occurrence(
  id: string,
  presentationClass: TvDurableEventOccurrence["presentationClass"],
): TvDurableEventOccurrence {
  return {
    id,
    type: presentationClass === "celebration" ? "user-milestone" : "email-delivery-degradation",
    presentationClass,
    lifecycle: presentationClass === "celebration" ? "occurred" : "active",
    occurredAt,
    activatedAt: occurredAt,
    resolvedAt: null,
  };
}

describe("TV event presentation orchestration", () => {
  it("anchors celebration Highlight and animation deadlines to occurrence time", () => {
    const celebration = occurrence("celebration", "celebration");
    const delayedStart = new Date("2026-07-29T10:30:00.000Z");
    expect(createTvPresentationAssignment({
      occurrence: celebration,
      preferences: preferences(),
      takeoverStartedAt: delayedStart,
    })).toMatchObject({
      takeoverStartedAt: delayedStart,
      takeoverEndsAt: new Date("2026-07-29T10:31:00.000Z"),
      animationExpiresAt: new Date("2026-07-29T11:00:00.000Z"),
      highlightExpiresAt: new Date("2026-07-29T16:00:00.000Z"),
    });
  });

  it("lets an Incident suspend a celebration without extending its clocks", () => {
    const celebration = occurrence("celebration", "celebration");
    const incident = occurrence("incident", "incident");
    const celebrationAssignment = createTvPresentationAssignment({
      occurrence: celebration,
      preferences: preferences(),
      takeoverStartedAt: occurredAt,
    });
    const incidentAssignment = createTvPresentationAssignment({
      occurrence: incident,
      preferences: preferences(),
      takeoverStartedAt: new Date("2026-07-29T10:00:10.000Z"),
    });
    expect(deriveTvPresentation({
      now: new Date("2026-07-29T10:00:20.000Z"),
      occurrences: [celebration, incident],
      assignments: [celebrationAssignment, incidentAssignment],
    })).toMatchObject({
      takeover: { occurrenceId: "incident", variant: "incident" },
      highlight: { occurrenceId: "incident", variant: "active-incident" },
    });
    expect(celebrationAssignment.animationExpiresAt).toEqual(new Date("2026-07-29T11:00:00.000Z"));
  });

  it("derives recovery from resolvedAt and resumes an unexpired celebration afterward", () => {
    const celebration = occurrence("celebration", "celebration");
    const incident: TvDurableEventOccurrence = {
      ...occurrence("incident", "critical-incident"),
      lifecycle: "resolved",
      resolvedAt: new Date("2026-07-29T10:20:00.000Z"),
    };
    const celebrationAssignment = createTvPresentationAssignment({
      occurrence: celebration,
      preferences: preferences(),
      takeoverStartedAt: occurredAt,
    });
    const incidentAssignment = {
      ...createTvPresentationAssignment({
        occurrence: incident,
        preferences: preferences(),
        takeoverStartedAt: occurredAt,
      }),
      recoveryEndsAt: new Date("2026-07-29T10:21:00.000Z"),
      highlightExpiresAt: new Date("2026-07-29T16:20:00.000Z"),
    };
    expect(deriveTvPresentation({
      now: new Date("2026-07-29T10:20:20.000Z"),
      occurrences: [celebration, incident],
      assignments: [celebrationAssignment, incidentAssignment],
    }).takeover).toMatchObject({
      occurrenceId: "incident",
      variant: "recovery-confirmation",
      endsAt: new Date("2026-07-29T10:21:00.000Z"),
    });
    expect(deriveTvPresentation({
      now: new Date("2026-07-29T10:21:01.000Z"),
      occurrences: [celebration, incident],
      assignments: [celebrationAssignment, incidentAssignment],
    }).highlight).toMatchObject({
      occurrenceId: "celebration",
      variant: "celebration",
    });
  });

  it("suppresses an expired delayed celebration but keeps a static Highlight after animation expiry", () => {
    const celebration = occurrence("celebration", "celebration");
    const assignment = createTvPresentationAssignment({
      occurrence: celebration,
      preferences: preferences(),
      takeoverStartedAt: null,
    });
    expect(deriveTvPresentation({
      now: new Date("2026-07-29T17:00:00.000Z"),
      occurrences: [celebration],
      assignments: [assignment],
    })).toEqual({ takeover: null, highlight: null });

    expect(deriveTvPresentation({
      now: new Date("2026-07-29T11:30:00.000Z"),
      occurrences: [celebration],
      assignments: [assignment],
    })).toMatchObject({
      takeover: null,
      highlight: {
        occurrenceId: "celebration",
        animationExpiresAt: new Date("2026-07-29T11:00:00.000Z"),
        expiresAt: new Date("2026-07-29T16:00:00.000Z"),
      },
    });
  });

  it("gives Critical Incident precedence without replaying an expired bounded takeover", () => {
    const incident = occurrence("incident", "incident");
    const critical = {
      ...occurrence("critical", "critical-incident"),
      activatedAt: new Date("2026-07-29T10:00:30.000Z"),
    };
    const incidentAssignment = createTvPresentationAssignment({
      occurrence: incident,
      preferences: preferences(),
      takeoverStartedAt: occurredAt,
    });
    const criticalAssignment = createTvPresentationAssignment({
      occurrence: critical,
      preferences: preferences(),
      takeoverStartedAt: critical.activatedAt,
    });
    expect(deriveTvPresentation({
      now: new Date("2026-07-29T10:02:00.000Z"),
      occurrences: [incident, critical],
      assignments: [incidentAssignment, criticalAssignment],
    })).toMatchObject({
      takeover: {
        occurrenceId: "critical",
        variant: "critical-incident",
        endsAt: new Date("2026-07-29T10:02:30.000Z"),
      },
      highlight: { occurrenceId: "critical" },
    });

    expect(deriveTvPresentation({
      now: new Date("2026-07-29T10:02:31.000Z"),
      occurrences: [incident, critical],
      assignments: [incidentAssignment, criticalAssignment],
    })).toMatchObject({
      takeover: null,
      highlight: { occurrenceId: "critical", variant: "active-incident" },
    });

    expect(deriveTvPresentation({
      now: new Date("2026-07-29T10:02:00.000Z"),
      occurrences: [incident],
      assignments: [incidentAssignment],
    })).toMatchObject({
      takeover: null,
      highlight: {
        occurrenceId: "incident",
        variant: "active-incident",
      },
    });
  });

  it("starts a fresh bounded Critical phase at the authoritative escalation time", () => {
    const escalatedAt = new Date("2026-07-29T10:03:00.000Z");
    const critical = occurrence("incident", "critical-incident");
    const assignment = createTvPresentationAssignment({
      occurrence: critical,
      preferences: preferences(),
      takeoverStartedAt: escalatedAt,
    });

    expect(assignment).toMatchObject({
      takeoverStartedAt: escalatedAt,
      takeoverEndsAt: new Date("2026-07-29T10:05:00.000Z"),
    });
    expect(deriveTvPresentation({
      now: new Date("2026-07-29T10:04:00.000Z"),
      occurrences: [critical],
      assignments: [assignment],
    }).takeover).toMatchObject({
      occurrenceId: "incident",
      variant: "critical-incident",
      startedAt: escalatedAt,
    });
  });

  it("skips a recovery takeover after its frozen event-time deadline", () => {
    const resolvedAt = new Date("2026-07-29T10:00:00.000Z");
    const resolved: TvDurableEventOccurrence = {
      ...occurrence("incident", "incident"),
      lifecycle: "resolved",
      resolvedAt,
    };
    const assignment = {
      ...createTvPresentationAssignment({
        occurrence: resolved,
        preferences: preferences(),
        takeoverStartedAt: occurredAt,
      }),
      recoveryEndsAt: new Date("2026-07-29T10:00:30.000Z"),
      highlightExpiresAt: new Date("2026-07-29T11:00:00.000Z"),
    };

    expect(deriveTvPresentation({
      now: new Date("2026-07-29T10:02:00.000Z"),
      occurrences: [resolved],
      assignments: [assignment],
    })).toMatchObject({
      takeover: null,
      highlight: { occurrenceId: "incident", variant: "resolved-incident" },
    });
  });
});
