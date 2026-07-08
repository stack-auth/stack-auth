"use client";

import { cn } from "@/components/ui";
import { motion, useReducedMotion } from "motion/react";
import { useMemo, useState, type ReactNode } from "react";
import { HeroStrip } from "../sections/hero-strip";
import { AgentLogChapter } from "./v1/agent-log";
import { MetricsChapter } from "./v1/metrics";
import { EDITORIAL_EASE, SERIF } from "./v1/primitives";
import {
  BenchmarksChapter,
  DeliveryColophon,
  EmailsChapter,
  IncidentChapter,
  OneThingChapter,
  ReplaysChapter,
  SalesChapter,
  SecurityChapter,
  TeamPulseChapter,
} from "./v1/rest";
import { SupportChapter } from "./v1/support";
import { ConnectorChapterContent, ConnectorsManager, CONNECTORS } from "./v1/connectors";

// Variation 1 — "Editorial". The briefing as a morning paper in the Dia
// idiom: painterly masthead, numbered chapters, serif headings on the left,
// content on the right, hairline rules throughout.

type Role = "admin" | "sales" | "support" | "engineer";
type Depth = "executive" | "operator";

const ROLES: { id: Role, label: string }[] = [
  { id: "admin", label: "Admin" },
  { id: "sales", label: "Sales" },
  { id: "support", label: "Support" },
  { id: "engineer", label: "Engineer" },
];

const ALL_ROLES: Role[] = ["admin", "sales", "support", "engineer"];

// Each chapter is scoped to roles (who may read it) and a depth: "executive"
// chapters survive the condensed read, the rest are operator detail.
const CHAPTERS: { id: string, title: string, blurb: string, roles: Role[], executive: boolean, content: ReactNode }[] = [
  {
    id: "agent-log",
    title: "While you slept",
    blurb: "Suggestions your briefing prepared overnight — nothing runs without your say-so.",
    roles: ALL_ROLES,
    executive: true,
    content: <AgentLogChapter />,
  },
  {
    id: "metrics",
    title: "Metrics that matter",
    blurb: "The arrivals worth greeting, the departures worth understanding, and one revenue anomaly explained.",
    roles: ["admin", "sales", "engineer"],
    executive: true,
    content: <MetricsChapter />,
  },
  {
    id: "support",
    title: "Support digest",
    blurb: "Seventeen tickets, three themes, and exactly one fire.",
    roles: ["admin", "support"],
    executive: false,
    content: <SupportChapter />,
  },
  {
    id: "replays",
    title: "Replays worth watching",
    blurb: "Three sessions your users would want you to see.",
    roles: ["admin", "support", "engineer"],
    executive: false,
    content: <ReplaysChapter />,
  },
  {
    id: "security",
    title: "Security report",
    blurb: "The scan came back clean; two logins and two admins deserve a look.",
    roles: ["admin", "engineer"],
    executive: false,
    content: <SecurityChapter />,
  },
  {
    id: "sales",
    title: "Today's play",
    blurb: "Three accounts to touch before they cool.",
    roles: ["admin", "sales"],
    executive: true,
    content: <SalesChapter />,
  },
  {
    id: "emails",
    title: "Drafted for you",
    blurb: "Review and send in one click. Nothing goes out without you.",
    roles: ["admin", "sales", "support"],
    executive: false,
    content: <EmailsChapter />,
  },
  {
    id: "incident",
    title: "The overnight incident",
    blurb: "Latency recovered at 03:12 without a page — but the leak that caused it is still there.",
    roles: ["admin", "engineer"],
    executive: true,
    content: <IncidentChapter />,
  },
  {
    id: "team-pulse",
    title: "Team pulse",
    blurb: "What your teammates changed since yesterday.",
    roles: ALL_ROLES,
    executive: false,
    content: <TeamPulseChapter />,
  },
  {
    id: "benchmarks",
    title: "How you compare",
    blurb: "Your numbers against every project your size on the platform.",
    roles: ["admin"],
    executive: true,
    content: <BenchmarksChapter />,
  },
  {
    id: "one-thing",
    title: "One thing",
    blurb: "The single highest-leverage action today, chosen for you.",
    roles: ALL_ROLES,
    executive: true,
    content: <OneThingChapter />,
  },
];

// Print-style switcher row: "READ AS" roles and "DEPTH" on one hairline strip.
function MastheadControls({
  role,
  onRole,
  depth,
  onDepth,
}: {
  role: Role,
  onRole: (role: Role) => void,
  depth: Depth,
  onDepth: (depth: Depth) => void,
}) {
  const item = (active: boolean) =>
    cn(
      "font-mono text-[11px] uppercase tracking-[0.16em] transition-colors",
      active
        ? "text-foreground underline decoration-foreground/50 underline-offset-4"
        : "text-foreground/40 hover:text-foreground/70",
    );
  return (
    <div className="flex flex-col gap-3 border-y border-black/[0.07] py-3.5 dark:border-white/[0.08] sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-foreground/35">Read as</span>
        {ROLES.map((r) => (
          <button key={r.id} type="button" onClick={() => onRole(r.id)} className={item(role === r.id)}>
            {r.label}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-foreground/35">Depth</span>
        {(["executive", "operator"] as Depth[]).map((d) => (
          <button key={d} type="button" onClick={() => onDepth(d)} className={item(depth === d)}>
            {d}
          </button>
        ))}
      </div>
    </div>
  );
}

function Chapter({
  index,
  title,
  blurb,
  children,
}: {
  index: number,
  title: string,
  blurb: string,
  children: ReactNode,
}) {
  const shouldReduceMotion = useReducedMotion();
  return (
    <motion.section
      initial={shouldReduceMotion ? false : { opacity: 0, y: 28 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.6, ease: EDITORIAL_EASE }}
      className="border-t border-black/[0.07] pt-10 dark:border-white/[0.08]"
    >
      <div className="grid gap-6 lg:grid-cols-[minmax(200px,250px)_1fr] lg:gap-14">
        <div className="lg:sticky lg:top-24 lg:self-start">
          <span className="font-mono text-xs tabular-nums tracking-[0.2em] text-foreground/35">
            {String(index + 1).padStart(2, "0")}
          </span>
          <h2 className={cn("mt-2 text-3xl leading-[1.05] tracking-tight text-foreground sm:text-4xl", SERIF)}>
            {title}
          </h2>
          <p className="mt-3 max-w-[26ch] text-sm leading-relaxed text-muted-foreground">{blurb}</p>
        </div>
        <div className="min-w-0">{children}</div>
      </div>
    </motion.section>
  );
}

type ChapterDef = (typeof CHAPTERS)[number];

export default function Variation1() {
  const [role, setRole] = useState<Role>("admin");
  const [depth, setDepth] = useState<Depth>("operator");
  const [connectedConnectors, setConnectedConnectors] = useState<Set<string>>(
    () => new Set(["slack", "google-workspace"]),
  );

  const toggleConnector = (id: string) => {
    setConnectedConnectors((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  // Chapters outside the role's permissions are omitted entirely; executive
  // depth trims the paper down to the load-bearing chapters. Every connected
  // MCP server contributes its own chapter after Team pulse, and the manager
  // itself sits just before the closer.
  const visibleChapters = useMemo(() => {
    const connectorChapters: ChapterDef[] = CONNECTORS.filter((c) => connectedConnectors.has(c.id)).map((c) => ({
      id: `connector-${c.id}`,
      title: c.chapterTitle,
      blurb: c.chapterBlurb,
      roles: ALL_ROLES,
      executive: false,
      content: <ConnectorChapterContent connector={c} />,
    }));
    const managerChapter: ChapterDef = {
      id: "connectors",
      title: "Connectors",
      blurb: "Wire more of your stack into tomorrow's brief — each server becomes a chapter.",
      roles: ["admin"],
      executive: false,
      content: <ConnectorsManager connected={connectedConnectors} onToggle={toggleConnector} />,
    };

    const list = [...CHAPTERS];
    const afterTeamPulse = list.findIndex((c) => c.id === "team-pulse") + 1;
    list.splice(afterTeamPulse, 0, ...connectorChapters);
    list.splice(list.findIndex((c) => c.id === "one-thing"), 0, managerChapter);

    return list.filter((c) => c.roles.includes(role) && (depth === "operator" || c.executive));
  }, [role, depth, connectedConnectors]);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-14 px-6 py-10 pb-32 sm:px-10">
      <HeroStrip />
      <div className="-mt-4">
        <MastheadControls role={role} onRole={setRole} depth={depth} onDepth={setDepth} />
      </div>
      {visibleChapters.map((chapter, index) => (
        <Chapter key={chapter.id} index={index} title={chapter.title} blurb={chapter.blurb}>
          {chapter.content}
        </Chapter>
      ))}
      <div className="border-t border-black/[0.07] pt-8 dark:border-white/[0.08]">
        <DeliveryColophon />
      </div>
    </div>
  );
}
