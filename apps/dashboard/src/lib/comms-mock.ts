"use client";

import { useSyncExternalStore } from "react";

export type CommsPlatform = "email" | "slack" | "discord" | "support" | "push";
export type CommsDirection = "inbound" | "outbound";

export type CommsContact = {
  id: string,
  name: string,
  role: string,
  company: string,
  avatarUrl: string,
  lifecycle: "Lead" | "Customer" | "Champion" | "At risk",
  owner: string,
  score: number,
  userId: string | null,
  source: string,
  tags: string[],
  lastTouchedAt: string,
  channels: {
    emails: string[],
    slackIds: string[],
    discordIds: string[],
    supportIds: string[],
    pushTokens: string[],
  },
  notes: string[],
};

export type CommsMessage = {
  id: string,
  platform: CommsPlatform,
  direction: CommsDirection,
  contactId: string,
  topicId: string,
  timestamp: string,
  channelLabel: string,
  subject?: string,
  htmlBody?: string,
  text: string,
  replyToId?: string,
  status: "new" | "triaged" | "sent" | "queued" | "failed",
  urgency: "low" | "normal" | "high",
  attachments: string[],
  aiReason: string,
};

export type CommsTopic = {
  id: string,
  title: string,
  summary: string,
  status: "open" | "waiting" | "resolved",
  confidence: number,
  owner: string,
  contactIds: string[],
  messageIds: string[],
  labels: string[],
};

export type CommsDraft = {
  id: string,
  platform: CommsPlatform,
  title: string,
  contactId: string,
  recipients: string[],
  channelLabel: string,
  subject: string,
  body: string,
  updatedAt: string,
  status: "draft" | "scheduled",
};

export const COMMS_PLATFORM_LABELS = {
  email: "Email",
  slack: "Shared Slack",
  discord: "Discord",
  support: "Support ticket",
  push: "Push",
} as const satisfies Record<CommsPlatform, string>;

export const COMMS_PLATFORM_OPTIONS = Object.entries(COMMS_PLATFORM_LABELS).map(([value, label]) => ({ value, label }));

export const COMMS_CONTACTS = [
  {
    id: "contact-maya",
    name: "Maya Chen",
    role: "Head of Support",
    company: "Nimbus Labs",
    avatarUrl: "https://api.dicebear.com/8.x/initials/svg?seed=Maya%20Chen",
    lifecycle: "Champion",
    owner: "Priya S.",
    score: 92,
    userId: "user_8f21",
    source: "Product signup",
    tags: ["enterprise", "workspace-admin", "beta"],
    lastTouchedAt: "2026-07-08T20:45:00.000Z",
    channels: {
      emails: ["maya@nimbus.example", "m.chen@personal.example"],
      slackIds: ["U04NIMBUS7", "U04NIMBUS9"],
      discordIds: ["maya.chen#1824"],
      supportIds: ["zendesk:49120"],
      pushTokens: ["ios:prod:maya-primary"],
    },
    notes: [
      "Primary buyer for support workflow consolidation.",
      "Prefers Slack for urgent incidents and email for weekly summaries.",
    ],
  },
  {
    id: "contact-omar",
    name: "Omar Haddad",
    role: "Solutions Engineer",
    company: "Aster Cloud",
    avatarUrl: "https://api.dicebear.com/8.x/initials/svg?seed=Omar%20Haddad",
    lifecycle: "Customer",
    owner: "Elena R.",
    score: 78,
    userId: "user_4bd2",
    source: "Shared Slack",
    tags: ["technical", "api", "renewal"],
    lastTouchedAt: "2026-07-08T19:20:00.000Z",
    channels: {
      emails: ["omar@aster.example"],
      slackIds: ["U02ASTER1"],
      discordIds: [],
      supportIds: ["intercom:conv-883"],
      pushTokens: ["webpush:omar-laptop", "webpush:omar-desktop"],
    },
    notes: [
      "Usually sends implementation questions without threading them.",
      "Account has renewal conversation active this month.",
    ],
  },
  {
    id: "contact-lina",
    name: "Lina Park",
    role: "Community Lead",
    company: "Forge Guild",
    avatarUrl: "https://api.dicebear.com/8.x/initials/svg?seed=Lina%20Park",
    lifecycle: "Lead",
    owner: "Mateo G.",
    score: 64,
    userId: null,
    source: "Discord community",
    tags: ["discord", "community", "prospect"],
    lastTouchedAt: "2026-07-08T18:10:00.000Z",
    channels: {
      emails: [],
      slackIds: [],
      discordIds: ["lina.guild#7744", "forge-lina#1190"],
      supportIds: [],
      pushTokens: [],
    },
    notes: [
      "No product account yet; only known through Discord.",
      "Interested in importing moderation context before launch.",
    ],
  },
  {
    id: "contact-sam",
    name: "Sam Rivera",
    role: "Growth PM",
    company: "BrightCart",
    avatarUrl: "https://api.dicebear.com/8.x/initials/svg?seed=Sam%20Rivera",
    lifecycle: "At risk",
    owner: "Hannah K.",
    score: 47,
    userId: "user_93aa",
    source: "Support ticket",
    tags: ["billing", "mobile", "escalated"],
    lastTouchedAt: "2026-07-08T16:35:00.000Z",
    channels: {
      emails: ["sam@brightcart.example"],
      slackIds: ["U09BRIGHT2"],
      discordIds: [],
      supportIds: ["linear:TICK-9021", "zendesk:50712"],
      pushTokens: ["android:brightcart-sam"],
    },
    notes: [
      "Needs careful follow-up after mobile push delay.",
      "Billing admin, but most support requests come through tickets.",
    ],
  },
] as const satisfies CommsContact[];

export const INITIAL_COMMS_MESSAGES = [
  {
    id: "msg-1001",
    platform: "email",
    direction: "inbound",
    contactId: "contact-maya",
    topicId: "topic-routing",
    timestamp: "2026-07-08T20:38:00.000Z",
    channelLabel: "maya@nimbus.example",
    subject: "Routing support replies by workspace",
    htmlBody: "<p>Can Comms route replies to the workspace owner when the original message came from a child account?</p>",
    text: "Can Comms route replies to the workspace owner when the original message came from a child account?",
    status: "new",
    urgency: "high",
    attachments: ["workspace-routing.csv"],
    aiReason: "Matched to the routing topic because the message asks about ownership and reply routing.",
  },
  {
    id: "msg-1002",
    platform: "slack",
    direction: "inbound",
    contactId: "contact-omar",
    topicId: "topic-api",
    timestamp: "2026-07-08T20:26:00.000Z",
    channelLabel: "#aster-shared / unthreaded",
    text: "Does the webhook payload include the topic id or do we need to call back into the API?",
    status: "triaged",
    urgency: "normal",
    attachments: [],
    aiReason: "Classified as API integration because it mentions webhook payloads and topic IDs.",
  },
  {
    id: "msg-1003",
    platform: "discord",
    direction: "inbound",
    contactId: "contact-lina",
    topicId: "topic-community",
    timestamp: "2026-07-08T20:12:00.000Z",
    channelLabel: "Forge Guild / #launch-planning",
    text: "If someone joins Discord before signing up, can we merge them into the same contact later?",
    status: "new",
    urgency: "normal",
    attachments: [],
    aiReason: "Assigned to community launch because the contact is Discord-only and asks about later merge behavior.",
  },
  {
    id: "msg-1004",
    platform: "support",
    direction: "inbound",
    contactId: "contact-sam",
    topicId: "topic-mobile-push",
    timestamp: "2026-07-08T19:58:00.000Z",
    channelLabel: "TICK-9021",
    subject: "Push notification delivery delay",
    text: "Android users are reporting a 10 minute delay on campaign push notifications.",
    status: "new",
    urgency: "high",
    attachments: ["ticket-log.txt"],
    aiReason: "Matched to mobile push because of Android delivery delay wording.",
  },
  {
    id: "msg-1005",
    platform: "email",
    direction: "outbound",
    contactId: "contact-maya",
    topicId: "topic-routing",
    timestamp: "2026-07-08T19:45:00.000Z",
    channelLabel: "maya@nimbus.example",
    subject: "Re: Routing support replies by workspace",
    htmlBody: "<p>Yes, we can model the owner as a contact-level rule and keep the original user's context attached.</p>",
    text: "Yes, we can model the owner as a contact-level rule and keep the original user's context attached.",
    status: "sent",
    urgency: "normal",
    attachments: [],
    aiReason: "Outbound reply continued the existing routing topic.",
  },
  {
    id: "msg-1006",
    platform: "push",
    direction: "outbound",
    contactId: "contact-sam",
    topicId: "topic-mobile-push",
    timestamp: "2026-07-08T19:30:00.000Z",
    channelLabel: "Android production",
    subject: "Delivery incident update",
    text: "We are investigating delayed campaign push notifications and will update you in the ticket.",
    status: "sent",
    urgency: "normal",
    attachments: [],
    aiReason: "Outbound push was associated with the active mobile delivery incident.",
  },
] as const satisfies CommsMessage[];

export const COMMS_TOPICS = [
  {
    id: "topic-routing",
    title: "Workspace reply routing",
    summary: "Nimbus wants replies to route through the right workspace owner while preserving child-account context.",
    status: "open",
    confidence: 94,
    owner: "Priya S.",
    contactIds: ["contact-maya"],
    messageIds: ["msg-1001", "msg-1005"],
    labels: ["routing", "enterprise"],
  },
  {
    id: "topic-api",
    title: "Webhook and API surfaces",
    summary: "Aster is validating which Comms identifiers appear in outbound webhook payloads.",
    status: "waiting",
    confidence: 86,
    owner: "Elena R.",
    contactIds: ["contact-omar"],
    messageIds: ["msg-1002"],
    labels: ["api", "webhooks"],
  },
  {
    id: "topic-community",
    title: "Discord-led launch planning",
    summary: "Forge Guild is testing Discord-first contact capture before product signup.",
    status: "open",
    confidence: 78,
    owner: "Mateo G.",
    contactIds: ["contact-lina"],
    messageIds: ["msg-1003"],
    labels: ["discord", "contacts"],
  },
  {
    id: "topic-mobile-push",
    title: "Mobile push delay",
    summary: "BrightCart escalated Android push delivery latency and needs proactive updates.",
    status: "open",
    confidence: 91,
    owner: "Hannah K.",
    contactIds: ["contact-sam"],
    messageIds: ["msg-1004", "msg-1006"],
    labels: ["push", "incident"],
  },
] as const satisfies CommsTopic[];

export const COMMS_DRAFTS = [
  {
    id: "draft-1",
    platform: "email",
    title: "Workspace routing follow-up",
    contactId: "contact-maya",
    recipients: ["maya@nimbus.example"],
    channelLabel: "maya@nimbus.example",
    subject: "Workspace routing design",
    body: "We can preserve the original user context while routing the reply to the workspace owner.",
    updatedAt: "2026-07-08T20:50:00.000Z",
    status: "draft",
  },
  {
    id: "draft-2",
    platform: "discord",
    title: "Discord identity merge notes",
    contactId: "contact-lina",
    recipients: ["lina.guild#7744"],
    channelLabel: "Forge Guild / #launch-planning",
    subject: "",
    body: "Yes, Discord-only contacts can later be merged with signup users while retaining both channel identities.",
    updatedAt: "2026-07-08T20:18:00.000Z",
    status: "scheduled",
  },
] as const satisfies CommsDraft[];

type IncomingTemplate = {
  platform: CommsPlatform,
  contactId: string,
  topicId: string,
  channelLabel: string,
  subject?: string,
  text: string,
  urgency: CommsMessage["urgency"],
  attachments?: string[],
  aiReason: string,
};

const incomingTemplates: IncomingTemplate[] = [
  {
    platform: "slack",
    contactId: "contact-omar",
    topicId: "topic-api",
    channelLabel: "#aster-shared / #implementation",
    text: "Tiny follow-up: can we subscribe to topic merge events separately from normal message events?",
    urgency: "normal",
    aiReason: "The unthreaded Slack question mentions topic merge events, so it remains in API surfaces.",
  },
  {
    platform: "email",
    contactId: "contact-maya",
    topicId: "topic-routing",
    channelLabel: "m.chen@personal.example",
    subject: "One more routing edge case",
    text: "What happens if two contacts are merged after a reply route has already been learned?",
    urgency: "high",
    attachments: ["routing-edge-case.png"],
    aiReason: "The message asks about merged contacts affecting routing, which belongs with workspace reply routing.",
  },
  {
    platform: "discord",
    contactId: "contact-lina",
    topicId: "topic-community",
    channelLabel: "Forge Guild / #moderator-chat",
    text: "Moderators are asking whether imported Discord IDs can have multiple aliases on the same contact.",
    urgency: "normal",
    aiReason: "Discord identity aliases are part of the Discord-led launch planning topic.",
  },
  {
    platform: "support",
    contactId: "contact-sam",
    topicId: "topic-mobile-push",
    channelLabel: "TICK-9021",
    subject: "New affected cohort",
    text: "We found that the delay only affects users who opted into promotional push notifications.",
    urgency: "high",
    attachments: ["affected-cohort.csv"],
    aiReason: "The ticket adds a cohort detail to the existing mobile push delivery incident.",
  },
];

let liveMessages: CommsMessage[] = [...INITIAL_COMMS_MESSAGES];
let intervalId: ReturnType<typeof setInterval> | null = null;
let generatedCount = 0;
const listeners = new Set<() => void>();

function getRandomTemplate(): IncomingTemplate {
  const template = incomingTemplates[Math.floor(Math.random() * incomingTemplates.length)];
  if (!template) {
    throw new Error("Expected at least one Comms incoming template.");
  }
  return template;
}

function createGeneratedMessage(): CommsMessage {
  generatedCount += 1;
  const template = getRandomTemplate();
  const textSuffixes = ["", " (new live inbound)", " — adding this before the next sync.", " Can someone confirm?"];
  const suffix = textSuffixes[Math.floor(Math.random() * textSuffixes.length)] ?? "";
  return {
    id: `msg-live-${generatedCount}`,
    platform: template.platform,
    direction: "inbound",
    contactId: template.contactId,
    topicId: template.topicId,
    timestamp: new Date().toISOString(),
    channelLabel: template.channelLabel,
    subject: template.subject,
    htmlBody: template.platform === "email" ? `<p>${template.text}${suffix}</p>` : undefined,
    text: `${template.text}${suffix}`,
    status: "new",
    urgency: template.urgency,
    attachments: template.attachments ?? [],
    aiReason: template.aiReason,
  };
}

function emit() {
  for (const listener of listeners) {
    listener();
  }
}

function ensureLiveFeedStarted() {
  if (intervalId !== null || typeof window === "undefined") {
    return;
  }
  intervalId = setInterval(() => {
    liveMessages = [createGeneratedMessage(), ...liveMessages].slice(0, 24);
    emit();
  }, 3_500);
}

function subscribeToCommsMessages(listener: () => void) {
  listeners.add(listener);
  ensureLiveFeedStarted();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && intervalId !== null) {
      clearInterval(intervalId);
      intervalId = null;
    }
  };
}

function getCommsMessagesSnapshot() {
  return liveMessages;
}

export function useCommsMessages() {
  return useSyncExternalStore(subscribeToCommsMessages, getCommsMessagesSnapshot, getCommsMessagesSnapshot);
}

export function getCommsContact(contactId: string): CommsContact | null {
  return COMMS_CONTACTS.find((contact) => contact.id === contactId) ?? null;
}

export function getCommsTopic(topicId: string): CommsTopic | null {
  return COMMS_TOPICS.find((topic) => topic.id === topicId) ?? null;
}

export function formatCommsTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Invalid date";
  }
  return date.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
