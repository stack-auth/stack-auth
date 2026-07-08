import { type AnalyticsCardGradient } from "@/components/design-components";
import {
  BellRingingIcon,
  CalendarCheckIcon,
  ChartLineUpIcon,
  ChatsCircleIcon,
  CrosshairIcon,
  EnvelopeSimpleIcon,
  FilmStripIcon,
  GaugeIcon,
  LightningIcon,
  PaperPlaneTiltIcon,
  RankingIcon,
  RobotIcon,
  ShieldCheckIcon,
  UsersThreeIcon,
  type Icon as PhosphorIcon,
} from "@phosphor-icons/react";

// The Daily Briefing is a concept prototype: everything on the page is mock
// data, and this module is the single source of truth for what sections exist,
// who sees them, and how they are labeled.

export type BriefingRole = "admin" | "sales" | "support" | "engineer";
export type BriefingDepth = "executive" | "operator";

export const BRIEFING_ROLES: { id: BriefingRole, label: string }[] = [
  { id: "admin", label: "Admin" },
  { id: "sales", label: "Sales" },
  { id: "support", label: "Support" },
  { id: "engineer", label: "Engineer" },
];

export type BriefingSectionId =
  | "agent-log"
  | "metrics"
  | "risk"
  | "incidents"
  | "support"
  | "replays"
  | "security"
  | "sales"
  | "emails"
  | "dossiers"
  | "team-pulse"
  | "benchmarks"
  | "one-thing"
  | "delivery";

export type BriefingSectionMeta = {
  title: string,
  // One-line summary shown in chapter cards and the customize drawer.
  blurb: string,
  icon: PhosphorIcon,
  accent: AnalyticsCardGradient,
  // Roles that see the section unlocked. Everyone else sees it blurred with
  // the permission chip — visible-but-locked is the demo story.
  roles: BriefingRole[],
  // Shown on the locked chip, e.g. "billing:read".
  requiredPermission: string,
  // Whether the section appears as a chapter card in the cinematic intro.
  chapter: boolean,
};

export const SECTION_ORDER: BriefingSectionId[] = [
  "agent-log",
  "metrics",
  "risk",
  "incidents",
  "support",
  "replays",
  "security",
  "sales",
  "emails",
  "dossiers",
  "team-pulse",
  "benchmarks",
  "one-thing",
  "delivery",
];

const ALL_ROLES: BriefingRole[] = ["admin", "sales", "support", "engineer"];

export const SECTION_META: Record<BriefingSectionId, BriefingSectionMeta> = {
  "agent-log": {
    title: "While you slept",
    blurb: "Actions your briefing agent already took overnight",
    icon: RobotIcon,
    accent: "purple",
    roles: ALL_ROLES,
    requiredPermission: "agent:read",
    chapter: true,
  },
  "metrics": {
    title: "Metrics that matter",
    blurb: "Revenue, signups, churn — with the anomalies explained",
    icon: ChartLineUpIcon,
    accent: "blue",
    roles: ["admin", "sales", "engineer"],
    requiredPermission: "billing:read",
    chapter: true,
  },
  "risk": {
    title: "Risk radar",
    blurb: "One project-health score and what is moving it",
    icon: GaugeIcon,
    accent: "orange",
    roles: ["admin", "engineer"],
    requiredPermission: "project:admin",
    chapter: true,
  },
  "incidents": {
    title: "Incidents & anomalies",
    blurb: "Overnight spikes, auto-correlated to the offending trace",
    icon: LightningIcon,
    accent: "orange",
    roles: ["admin", "engineer"],
    requiredPermission: "telemetry:read",
    chapter: true,
  },
  "support": {
    title: "Support digest",
    blurb: "Tickets clustered into themes, one fire to put out",
    icon: ChatsCircleIcon,
    accent: "cyan",
    roles: ["admin", "support"],
    requiredPermission: "support:read",
    chapter: true,
  },
  "replays": {
    title: "Replays worth watching",
    blurb: "Three sessions your users want you to see",
    icon: FilmStripIcon,
    accent: "purple",
    roles: ["admin", "support", "engineer"],
    requiredPermission: "replays:read",
    chapter: true,
  },
  "security": {
    title: "Security report",
    blurb: "Secret scan, unusual logins, and who still needs MFA",
    icon: ShieldCheckIcon,
    accent: "green",
    roles: ["admin", "engineer"],
    requiredPermission: "security:read",
    chapter: true,
  },
  "sales": {
    title: "Today's play",
    blurb: "Three accounts to touch and why now",
    icon: CrosshairIcon,
    accent: "blue",
    roles: ["admin", "sales"],
    requiredPermission: "crm:read",
    chapter: true,
  },
  "emails": {
    title: "Drafted for you",
    blurb: "Emails written overnight — review and send in one click",
    icon: PaperPlaneTiltIcon,
    accent: "cyan",
    roles: ["admin", "sales", "support"],
    requiredPermission: "emails:send",
    chapter: true,
  },
  "dossiers": {
    title: "Before your meetings",
    blurb: "A dossier for every call on today's calendar",
    icon: CalendarCheckIcon,
    accent: "slate",
    roles: ["admin", "sales"],
    requiredPermission: "calendar:read",
    chapter: false,
  },
  "team-pulse": {
    title: "Team pulse",
    blurb: "What your teammates changed since yesterday",
    icon: UsersThreeIcon,
    accent: "slate",
    roles: ALL_ROLES,
    requiredPermission: "audit:read",
    chapter: false,
  },
  "benchmarks": {
    title: "How you compare",
    blurb: "Your numbers against similar projects on the platform",
    icon: RankingIcon,
    accent: "green",
    roles: ["admin"],
    requiredPermission: "billing:read",
    chapter: false,
  },
  "one-thing": {
    title: "One thing to fix today",
    blurb: "The single highest-leverage action, picked for you",
    icon: BellRingingIcon,
    accent: "orange",
    roles: ALL_ROLES,
    requiredPermission: "project:read",
    chapter: true,
  },
  "delivery": {
    title: "Delivery",
    blurb: "Where your briefing goes: dashboard, email, iMessage… fax",
    icon: EnvelopeSimpleIcon,
    accent: "slate",
    roles: ["admin"],
    requiredPermission: "project:admin",
    chapter: false,
  },
};

// Every section widget receives the current reading depth: "executive" renders
// the 3-bullet altitude, "operator" the full detail.
export type SectionWidgetProps = {
  depth: BriefingDepth,
};

export function isSectionUnlockedForRole(sectionId: BriefingSectionId, role: BriefingRole): boolean {
  return SECTION_META[sectionId].roles.includes(role);
}
