export const GTM_ACTION_TYPES = ["checkout_recovery_email", "broadcast_email", "config_change"] as const;
export const GTM_ACTION_STATUSES = ["proposed", "approved", "executing", "executed", "failed", "rejected", "expired"] as const;
export const GTM_VERDICTS = ["worked", "didnt_work", "inconclusive", "never_measured", "rejected_by_you", "expired"] as const;
export const GTM_NOTE_CATEGORIES = ["company", "audience", "strategy", "user_preference", "learning"] as const;
export const GTM_NOTE_SOURCES = ["chat", "run", "user"] as const;
export const GTM_DOMAINS = ["product", "users", "ads", "outreach", "content", "revenue"] as const;

export type GtmActionType = typeof GTM_ACTION_TYPES[number];
export type GtmActionStatus = typeof GTM_ACTION_STATUSES[number];
export type GtmVerdict = typeof GTM_VERDICTS[number];
export type GtmNoteCategory = typeof GTM_NOTE_CATEGORIES[number];
export type GtmNoteSource = typeof GTM_NOTE_SOURCES[number];
export type GtmDomainId = typeof GTM_DOMAINS[number];

/**
 * One hand-written entry of a suggestion timeline: a small-caps label, a headline, a date, and prose.
 * Everything a customer reads in a timeline is written by the growth team — nothing is derived from the
 * record's other fields.
 */
export type GtmTimelineEntry = {
  label: string,
  title: string,
  body: string,
  dateMillis: number,
};

/**
 * A suggestion's timeline entries, or `null` when nobody has written any. Both render the same empty state;
 * the distinction survives because the API and stored rows keep "never touched" apart from "emptied on
 * purpose", which is worth knowing when reading the data even though the page treats them alike.
 */
export type GtmTimeline = GtmTimelineEntry[] | null;

export type GtmInsight = {
  id: string,
  createdAtMillis: number,
  updatedAtMillis: number,
  domain: GtmDomainId,
  title: string,
  body: string,
  impactScore: number,
  timesSeen: number,
  lastSeenAtMillis: number,
  timeline: GtmTimeline,
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
  timeline: GtmTimeline,
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
