export const GTM_INSIGHT_KINDS = ["funnel_dropoff", "segment_lift", "retention", "send_time", "checkout_abandonment", "friction_hotspot", "qualitative_theme", "data_gap", "measurement"] as const;
export const GTM_INSIGHT_STATUSES = ["new", "surfaced", "acknowledged", "dismissed", "measured", "archived"] as const;
export const GTM_CONFIDENCES = ["high", "medium", "low"] as const;
export const GTM_ACTION_TYPES = ["checkout_recovery_email", "broadcast_email", "config_change"] as const;
export const GTM_ACTION_STATUSES = ["proposed", "approved", "executing", "executed", "failed", "rejected", "expired"] as const;
export const GTM_VERDICTS = ["worked", "didnt_work", "inconclusive", "never_measured", "rejected_by_you", "expired"] as const;
export const GTM_NOTE_CATEGORIES = ["company", "audience", "strategy", "user_preference", "learning"] as const;
export const GTM_NOTE_SOURCES = ["chat", "run", "user"] as const;
export const GTM_DOMAINS = ["product", "users", "ads", "outreach", "content", "revenue"] as const;

export type GtmInsightKind = typeof GTM_INSIGHT_KINDS[number];
export type GtmInsightStatus = typeof GTM_INSIGHT_STATUSES[number];
export type GtmConfidence = typeof GTM_CONFIDENCES[number];
export type GtmActionType = typeof GTM_ACTION_TYPES[number];
export type GtmActionStatus = typeof GTM_ACTION_STATUSES[number];
export type GtmVerdict = typeof GTM_VERDICTS[number];
export type GtmNoteCategory = typeof GTM_NOTE_CATEGORIES[number];
export type GtmNoteSource = typeof GTM_NOTE_SOURCES[number];
export type GtmDomainId = typeof GTM_DOMAINS[number];

export type GtmInsight = {
  id: string,
  createdAtMillis: number,
  updatedAtMillis: number,
  domain: GtmDomainId,
  kind: GtmInsightKind,
  status: GtmInsightStatus,
  confidence: GtmConfidence,
  title: string,
  body: string,
  impactScore: number,
  timesSeen: number,
  lastSeenAtMillis: number,
};

export type GtmAction = {
  id: string,
  createdAtMillis: number,
  updatedAtMillis: number,
  domain: GtmDomainId,
  type: GtmActionType,
  status: GtmActionStatus,
  title: string,
  summary: string,
  verdict: GtmVerdict | null,
  retrospective: string | null,
  expiresAtMillis: number,
  executedAtMillis: number | null,
};

export type GtmNote = {
  id: string,
  createdAtMillis: number,
  updatedAtMillis: number,
  domain: GtmDomainId,
  category: GtmNoteCategory,
  title: string | null,
  body: string,
  source: GtmNoteSource,
  lastConfirmedAtMillis: number,
};

export type GtmDataset = {
  insights: GtmInsight[],
  actions: GtmAction[],
  notes: GtmNote[],
  radar: Map<GtmDomainId, number> | null,
};

export function actionTypeLabel(type: GtmActionType): string {
  return new Map<GtmActionType, string>([
    ["checkout_recovery_email", "Checkout recovery email"],
    ["broadcast_email", "Broadcast email"],
    ["config_change", "Config change"],
  ]).get(type) ?? type;
}

export function classifyInsight(insight: GtmInsight): GtmDomainId {
  return insight.domain;
}

export function classifyAction(action: GtmAction): GtmDomainId {
  return action.domain;
}

export function classifyNote(note: GtmNote): GtmDomainId {
  return note.domain;
}
