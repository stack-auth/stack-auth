import type { ContinuumIncidentStory } from "./types";

export const INCIDENT_STORY: ContinuumIncidentStory = {
  id: "enterprise-roles-rollout",
  title: "v1.0.47 — Enterprise Roles Update",
  durationMs: 180_000,
  stages: [
    {
      id: "act1-ready",
      act: 1,
      offsetMs: 0,
      title: "Ready to ship",
      summary: "v1.0.47 is built. Compat is green for both versions. Two expand steps already applied; one cleanup step is waiting.",
      overrides: {
        metrics: [
          { id: "error-rate", value: 0.4 },
          { id: "arr-at-risk", value: 0 },
          { id: "cells-healthy", value: 10 },
        ],
        logLines: [
          "Build ready · Next.js 15.2",
          "Compat matrix: v1.0.46 + v1.0.47 all green",
          "Deferred: DROP COLUMN legacy_role (held until window closes)",
        ],
      },
      gate: {
        actionLabel: "Start Rollout",
        preview: "Ship to internal orgs first, then 20% of free orgs. Everyone else stays on the previous version until each stage looks healthy.",
      },
    },
    {
      id: "act1-stages-green",
      act: 1,
      offsetMs: 8_000,
      title: "Stages 1 and 2 look good",
      summary: "This update is going out to your smallest customers first. So far, all good.",
      overrides: {
        cellStates: {
          "cell-internal": "healthy",
          "cell-free-1": "healthy",
          "cell-free-2": "healthy",
        },
        metrics: [
          { id: "error-rate", value: 0.5 },
          { id: "arr-at-risk", value: 0 },
          { id: "cells-healthy", value: 10 },
        ],
        logLines: [
          "Stage 1 Internal orgs — healthy",
          "Stage 2 20% free orgs — healthy",
        ],
      },
    },
    {
      id: "act2-break",
      act: 2,
      offsetMs: 22_000,
      title: "Something broke — only for big customers",
      summary: "3 of your biggest customers hit an error when inviting admins — $184k of revenue is on those accounts. Free and small tenants are fine.",
      overrides: {
        cellStates: {
          "cell-atlas": "degraded",
          "cell-northstar": "degraded",
          "cell-lumen": "degraded",
        },
        edgeHealth: {
          "e-atlas-cell": "critical",
          "e-ns-cell": "degraded",
          "e-lumen-cell": "degraded",
        },
        metrics: [
          { id: "error-rate", value: 8.7 },
          { id: "arr-at-risk", value: 184_000 },
          { id: "cells-healthy", value: 7 },
        ],
        logLines: [
          "Auto-paused rollout at stage 4",
          "Errors isolated to invitations endpoint · large orgs only",
          "8 session replays available · Atlas, Northstar, Lumen",
        ],
      },
      gate: {
        actionLabel: "Protect Affected Tenants",
        preview: "Pause the rollout, pin Atlas / Northstar / Lumen back to the previous version (schema still supports both), restore their databases, and keep everyone else on the new version.",
      },
    },
    {
      id: "act3-protect",
      act: 3,
      offsetMs: 40_000,
      title: "Those customers are protected",
      summary: "Atlas Health is back on the previous version. The cleanup step is still waiting — so undo stayed safe. Sessions lost: 0. Re-auths forced: 0.",
      overrides: {
        cellStates: {
          "cell-atlas": "pinned",
          "cell-northstar": "protected",
          "cell-lumen": "protected",
        },
        edgeHealth: {
          "e-atlas-cell": "healthy",
          "e-ns-cell": "healthy",
          "e-lumen-cell": "healthy",
          "e-failover": "active",
        },
        metrics: [
          { id: "error-rate", value: 0.6 },
          { id: "arr-at-risk", value: 0 },
          { id: "cells-healthy", value: 10 },
          { id: "sessions-lost", value: 0 },
          { id: "reauths-forced", value: 0 },
        ],
        logLines: [
          "Rollout paused ✓",
          "Tenants isolated ✓",
          "Pinned to v1.0.46 — safe, contract step still deferred ✓",
          "Database restored to safe checkpoint ✓",
          "Traffic switched ✓",
          "Atlas warm-standby failover on GCP · lag → 0ms",
          "Sessions lost: 0 · Re-auths forced: 0",
        ],
      },
      gate: {
        actionLabel: "Create Forensic Clone",
        preview: "Make a safe copy of Atlas production data — emails and names replaced with fakes — then attach logs, replays, and tenant config for the agent.",
      },
    },
    {
      id: "act4-clone",
      act: 4,
      offsetMs: 70_000,
      title: "Forensic clone ready",
      summary: "A safe copy is ready with a temporary URL (expires in 30 minutes). The agent can reproduce the bug without touching real customer data.",
      overrides: {
        logLines: [
          "Snapshot → sample → anonymize → verify → ready",
          "Redaction report: 5 fields transformed, referential integrity kept",
          "Temporary URL issued · 30 min expiry",
        ],
      },
      gate: {
        actionLabel: "Approve Agent Access",
        preview: "Devin wants temporary read access to organization_roles in the sanitized clone — expires in 30 minutes.",
      },
    },
    {
      id: "act4-fix",
      act: 4,
      offsetMs: 95_000,
      title: "Fix verified in the clone",
      summary: "The agent reproduced the bug, shipped a fix, and flipped the repro from Failed to Passed. Compat and regression checks are green.",
      overrides: {
        logLines: [
          "Repro: Failed → Passed",
          "Compat check: green",
          "Regression suite: green",
        ],
      },
      gate: {
        actionLabel: "Resume Global Rollout",
        preview: "Ship the fix to the affected tenants first, hold healthy, then continue the global rollout. When the last tenant leaves the old version, the deferred cleanup releases on its own.",
      },
    },
    {
      id: "act5-recover",
      act: 5,
      offsetMs: 130_000,
      title: "Recovered — cleanup finished itself",
      summary: "Affected tenants isolated and recovered without rolling back healthy customers. The schema cleanup you'd normally forget just happened, safely, by itself.",
      overrides: {
        cellStates: {
          "cell-atlas": "healthy",
          "cell-northstar": "healthy",
          "cell-lumen": "healthy",
        },
        edgeHealth: {
          "e-failover": "healthy",
        },
        metrics: [
          { id: "error-rate", value: 0.4 },
          { id: "arr-at-risk", value: 0 },
          { id: "cells-healthy", value: 10 },
        ],
        logLines: [
          "Last tenant reached v1.0.47 · version window closed",
          "Deferred DROP COLUMN legacy_role released automatically",
          "Global rollout complete",
        ],
      },
    },
  ],
  closingCard: {
    title: "Incident closed",
    bullets: [
      "Affected tenants isolated and recovered without rolling back healthy customers",
      "Avoided downtime: 47 minutes",
      "Protected revenue: $184,000 ARR",
      "Sessions lost: 0 · Re-auths forced: 0",
    ],
    avoidedDowntimeMinutes: 47,
    protectedArrUsd: 184_000,
  },
};

export function getIncidentStage(story: ContinuumIncidentStory, elapsedMs: number) {
  let selected = story.stages[0];
  for (const stage of story.stages) {
    if (stage.offsetMs > elapsedMs) break;
    selected = stage;
  }
  return selected;
}

export function formatIncidentTime(elapsedMs: number): string {
  const clampedMs = Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) : 0;
  const totalSeconds = Math.floor(clampedMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function getStageIndex(story: ContinuumIncidentStory, elapsedMs: number): number {
  const stage = getIncidentStage(story, elapsedMs);
  return story.stages.findIndex((s) => s.id === stage.id);
}
