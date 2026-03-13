import type { ReplayIssueEvidence, ReplayIssueSeverity, ReplayVisualArtifact } from "@stackframe/stack-shared/dist/interface/crud/replay-ai";

export type ReplayTimelineEvent = {
  eventType: string,
  eventAtMs: number,
  data: Record<string, unknown>,
};

export type DeterministicReplayAnalysis = {
  fingerprint: string,
  issueTitle: string,
  summary: string,
  whyLikely: string,
  severity: ReplayIssueSeverity,
  confidence: number,
  evidence: ReplayIssueEvidence[],
  visualArtifacts: ReplayVisualArtifact[],
};

type SignalCategory = "frontend-error" | "network-error" | "rage-click" | "dead-click" | "form-abandonment" | "idle-stall" | "general-friction";

type DetectedSignal = {
  category: SignalCategory,
  route: string,
  title: string,
  severity: ReplayIssueSeverity,
  confidence: number,
  evidence: ReplayIssueEvidence[],
  whyLikely: string,
};

export function analyzeReplayDeterministically(options: {
  startedAtMs: number,
  lastEventAtMs: number,
  timelineEvents: ReplayTimelineEvent[],
}): DeterministicReplayAnalysis {
  const sortedEvents = [...options.timelineEvents].sort((a, b) => a.eventAtMs - b.eventAtMs);
  const routeTimeline = buildRouteTimeline(sortedEvents);

  const signals = [
    detectFrontendErrors(options.startedAtMs, sortedEvents, routeTimeline),
    detectNetworkErrors(options.startedAtMs, sortedEvents, routeTimeline),
    detectRageClicks(options.startedAtMs, sortedEvents, routeTimeline),
    detectDeadClicks(options.startedAtMs, sortedEvents, routeTimeline),
    detectFormAbandonment(options.startedAtMs, options.lastEventAtMs, sortedEvents, routeTimeline),
    detectIdleStall(options.startedAtMs, options.lastEventAtMs, sortedEvents, routeTimeline),
  ].flat();

  const winningSignal = chooseWinningSignal(signals, sortedEvents, routeTimeline, options.startedAtMs, options.lastEventAtMs);

  return {
    fingerprint: `${winningSignal.category}:${winningSignal.route}`,
    issueTitle: winningSignal.title,
    summary: buildSummary(winningSignal),
    whyLikely: winningSignal.whyLikely,
    severity: winningSignal.severity,
    confidence: winningSignal.confidence,
    evidence: winningSignal.evidence,
    visualArtifacts: winningSignal.evidence.slice(0, 3).map((evidence, index) => ({
      id: `artifact-${index + 1}`,
      display_name: evidence.label,
      kind: "timeline-card",
      start_offset_ms: evidence.start_offset_ms,
      mime_type: null,
      data_url: null,
      alt_text: `${evidence.label}: ${evidence.reason}`,
    })),
  };
}

function buildSummary(signal: DetectedSignal): string {
  const prefix = signal.route === "/" ? "This replay shows friction on the home route." : `This replay shows friction on ${signal.route}.`;
  return `${prefix} ${signal.evidence[0]?.reason ?? "The session contains a clustered failure pattern."}`;
}

function buildRouteTimeline(events: ReplayTimelineEvent[]): Array<{ atMs: number, route: string }> {
  const timeline: Array<{ atMs: number, route: string }> = [];
  for (const event of events) {
    if (event.eventType !== "$page-view") continue;
    const route = getRouteFromEvent(event);
    timeline.push({ atMs: event.eventAtMs, route });
  }
  if (timeline.length === 0) {
    timeline.push({ atMs: events[0]?.eventAtMs ?? 0, route: "/" });
  }
  return timeline;
}

function routeAt(routeTimeline: Array<{ atMs: number, route: string }>, atMs: number): string {
  let selected = routeTimeline[0]?.route ?? "/";
  for (const item of routeTimeline) {
    if (item.atMs > atMs) break;
    selected = item.route;
  }
  return selected;
}

function detectFrontendErrors(
  startedAtMs: number,
  events: ReplayTimelineEvent[],
  routeTimeline: Array<{ atMs: number, route: string }>,
): DetectedSignal[] {
  const errorEvents = events.filter((event) => event.eventType === "$error");
  if (errorEvents.length === 0) return [];
  const firstError = errorEvents[0]!;
  const route = routeAt(routeTimeline, firstError.eventAtMs);
  return [{
    category: "frontend-error",
    route,
    title: "Frontend error surfaced during replay",
    severity: "high",
    confidence: 0.95,
    evidence: [{
      label: "Application error",
      reason: getString(firstError.data, "message") ?? "A client-side error event was recorded.",
      start_offset_ms: Math.max(0, firstError.eventAtMs - startedAtMs - 1_000),
      end_offset_ms: Math.max(0, firstError.eventAtMs - startedAtMs + 1_500),
      event_type: firstError.eventType,
    }],
    whyLikely: "A browser error event was captured directly from the session timeline, so this replay likely reflects a real user-facing failure rather than inferred friction.",
  }];
}

function detectNetworkErrors(
  startedAtMs: number,
  events: ReplayTimelineEvent[],
  routeTimeline: Array<{ atMs: number, route: string }>,
): DetectedSignal[] {
  const networkErrorEvents = events.filter((event) => event.eventType === "$network-error");
  if (networkErrorEvents.length === 0) return [];
  const firstError = networkErrorEvents[0]!;
  const route = routeAt(routeTimeline, firstError.eventAtMs);
  const failingUrl = getString(firstError.data, "url");
  return [{
    category: "network-error",
    route,
    title: "Network failure interrupted the session",
    severity: "high",
    confidence: 0.88,
    evidence: [{
      label: "Failed request",
      reason: failingUrl ? `A network request to ${failingUrl} failed during the replay.` : "A network request failed during the replay.",
      start_offset_ms: Math.max(0, firstError.eventAtMs - startedAtMs - 1_000),
      end_offset_ms: Math.max(0, firstError.eventAtMs - startedAtMs + 2_000),
      event_type: firstError.eventType,
    }],
    whyLikely: "The analytics timeline recorded an explicit network-error event, which usually means a request failed before the user could complete the flow.",
  }];
}

function detectRageClicks(
  startedAtMs: number,
  events: ReplayTimelineEvent[],
  routeTimeline: Array<{ atMs: number, route: string }>,
): DetectedSignal[] {
  const clickEvents = events.filter((event) => event.eventType === "$click");
  const selectors = new Map<string, ReplayTimelineEvent[]>();
  for (const event of clickEvents) {
    const selector = getString(event.data, "selector");
    if (selector == null) continue;
    const current = selectors.get(selector) ?? [];
    current.push(event);
    selectors.set(selector, current);
  }

  for (const [selector, selectorEvents] of selectors.entries()) {
    for (let index = 0; index < selectorEvents.length; index++) {
      const first = selectorEvents[index]!;
      const windowEvents = selectorEvents.filter((candidate) => candidate.eventAtMs >= first.eventAtMs && candidate.eventAtMs <= first.eventAtMs + 4_000);
      if (windowEvents.length < 3) continue;
      const route = routeAt(routeTimeline, first.eventAtMs);
      return [{
        category: "rage-click",
        route,
        title: "User repeatedly clicked an unresponsive target",
        severity: "medium",
        confidence: 0.84,
        evidence: [{
          label: "Rage click burst",
          reason: `The same target (${selector}) was clicked ${windowEvents.length} times in under 4 seconds.`,
          start_offset_ms: Math.max(0, first.eventAtMs - startedAtMs - 500),
          end_offset_ms: Math.max(0, windowEvents[windowEvents.length - 1]!.eventAtMs - startedAtMs + 500),
          event_type: "$click",
        }],
        whyLikely: "Repeated clicks against the same selector in a short window are a strong sign that the user expected a response and did not get one.",
      }];
    }
  }
  return [];
}

function detectDeadClicks(
  startedAtMs: number,
  events: ReplayTimelineEvent[],
  routeTimeline: Array<{ atMs: number, route: string }>,
): DetectedSignal[] {
  const clickEvents = events.filter((event) => event.eventType === "$click");
  for (const click of clickEvents) {
    const nextRelevantEvent = events.find((event) =>
      event.eventAtMs > click.eventAtMs &&
      event.eventAtMs <= click.eventAtMs + 3_000 &&
      (event.eventType === "$page-view" || event.eventType === "$submit"),
    );
    if (nextRelevantEvent != null) continue;
    const route = routeAt(routeTimeline, click.eventAtMs);
    const selector = getString(click.data, "selector") ?? "unknown target";
    return [{
      category: "dead-click",
      route,
      title: "User clicked but the flow did not progress",
      severity: "medium",
      confidence: 0.74,
      evidence: [{
        label: "Dead click",
        reason: `The click on ${selector} was not followed by navigation or a submit event.`,
        start_offset_ms: Math.max(0, click.eventAtMs - startedAtMs - 500),
        end_offset_ms: Math.max(0, click.eventAtMs - startedAtMs + 3_000),
        event_type: "$click",
      }],
      whyLikely: "This click was followed by neither navigation nor submit activity, which suggests the interaction did not meaningfully advance the user.",
    }];
  }
  return [];
}

function detectFormAbandonment(
  startedAtMs: number,
  lastEventAtMs: number,
  events: ReplayTimelineEvent[],
  routeTimeline: Array<{ atMs: number, route: string }>,
): DetectedSignal[] {
  const inputEvents = events.filter((event) => event.eventType === "$input");
  if (inputEvents.length === 0) return [];
  const submitEvents = events.filter((event) => event.eventType === "$submit");
  const lastInput = inputEvents[inputEvents.length - 1]!;
  const matchingSubmit = submitEvents.find((event) => event.eventAtMs >= lastInput.eventAtMs);
  if (matchingSubmit != null) return [];
  if (lastEventAtMs - lastInput.eventAtMs < 20_000) return [];
  const route = routeAt(routeTimeline, lastInput.eventAtMs);
  return [{
    category: "form-abandonment",
    route,
    title: "User abandoned a form before submitting",
    severity: "medium",
    confidence: 0.7,
    evidence: [{
      label: "Form abandoned",
      reason: "Input activity was captured, but no submit event followed before the session went idle.",
      start_offset_ms: Math.max(0, lastInput.eventAtMs - startedAtMs - 1_000),
      end_offset_ms: Math.max(0, lastEventAtMs - startedAtMs),
      event_type: "$input",
    }],
    whyLikely: "The replay contains input interaction without a later submit, which often indicates a blocked or confusing form flow.",
  }];
}

function detectIdleStall(
  startedAtMs: number,
  lastEventAtMs: number,
  events: ReplayTimelineEvent[],
  routeTimeline: Array<{ atMs: number, route: string }>,
): DetectedSignal[] {
  if (events.length === 0) return [];
  let largestGapStart = events[0]!.eventAtMs;
  let largestGapEnd = lastEventAtMs;
  let largestGap = lastEventAtMs - events[0]!.eventAtMs;

  for (let index = 1; index < events.length; index++) {
    const previous = events[index - 1]!;
    const current = events[index]!;
    const gap = current.eventAtMs - previous.eventAtMs;
    if (gap > largestGap) {
      largestGap = gap;
      largestGapStart = previous.eventAtMs;
      largestGapEnd = current.eventAtMs;
    }
  }

  if (largestGap < 20_000) return [];
  const route = routeAt(routeTimeline, largestGapStart);
  return [{
    category: "idle-stall",
    route,
    title: "The session stalled for an unusually long time",
    severity: "low",
    confidence: 0.58,
    evidence: [{
      label: "Idle stall",
      reason: `There was a ${(largestGap / 1000).toFixed(0)} second gap in interaction or navigation activity.`,
      start_offset_ms: Math.max(0, largestGapStart - startedAtMs),
      end_offset_ms: Math.max(0, largestGapEnd - startedAtMs),
      event_type: null,
    }],
    whyLikely: "A large inactivity window immediately after interaction often indicates the user was waiting for a response or deciding whether the flow was broken.",
  }];
}

function chooseWinningSignal(
  signals: DetectedSignal[],
  events: ReplayTimelineEvent[],
  routeTimeline: Array<{ atMs: number, route: string }>,
  startedAtMs: number,
  lastEventAtMs: number,
): DetectedSignal {
  if (signals.length > 0) {
    return [...signals].sort(compareSignals)[0]!;
  }

  const route = routeAt(routeTimeline, events[0]?.eventAtMs ?? startedAtMs);
  return {
    category: "general-friction",
    route,
    title: "Session replay ready for AI review",
    severity: "low",
    confidence: 0.35,
    evidence: [{
      label: "Replay overview",
      reason: `The replay spans ${Math.max(1, Math.round((lastEventAtMs - startedAtMs) / 1000))} seconds and did not match a stronger failure heuristic yet.`,
      start_offset_ms: 0,
      end_offset_ms: Math.max(0, lastEventAtMs - startedAtMs),
      event_type: null,
    }],
    whyLikely: "No dominant deterministic failure pattern was detected, so this replay is currently classified as general friction until more evidence accumulates.",
  };
}

function compareSignals(a: DetectedSignal, b: DetectedSignal): number {
  const severityRank = new Map<ReplayIssueSeverity, number>([
    ["critical", 0],
    ["high", 1],
    ["medium", 2],
    ["low", 3],
  ]);
  const severityDiff = (severityRank.get(a.severity) ?? 99) - (severityRank.get(b.severity) ?? 99);
  if (severityDiff !== 0) return severityDiff;
  return b.confidence - a.confidence;
}

function getRouteFromEvent(event: ReplayTimelineEvent): string {
  const path = getString(event.data, "path");
  if (path != null && path.length > 0) return path;
  const url = getString(event.data, "url");
  if (url == null || url.length === 0) return "/";
  try {
    return new URL(url).pathname || "/";
  } catch {
    return url.startsWith("/") ? url : "/";
  }
}

function getString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}
