export type DailyBriefSuggestion = {
  id: string,
  title: string,
  summary: string,
  impact: string,
  actionLabel: string,
};

export type DailyBriefBullet = {
  label: string,
  text: string,
};

export type DailyBriefMetric = {
  label: string,
  value: string,
  delta: string,
  tone: "good" | "watch" | "neutral",
};

export type DailyBriefImportantUser = {
  name: string,
  email: string,
  company: string,
  signal: string,
};

export type DailyBriefVisual = {
  title: string,
  caption: string,
  kind: "chart" | "screenshot" | "map",
};

export type DailyBriefBlock =
  | { type: "bullets", bullets: DailyBriefBullet[] }
  | { type: "metrics", metrics: DailyBriefMetric[] }
  | { type: "users", users: DailyBriefImportantUser[] }
  | { type: "visual", visual: DailyBriefVisual }
  | { type: "suggestion", suggestion: DailyBriefSuggestion };

export type DailyBriefSection = {
  heading: string,
  intro?: string,
  blocks: DailyBriefBlock[],
};

export type DailyBrief = {
  id: string,
  dateLabel: string,
  dayLabel: string,
  title: string,
  summary: string,
  readTime: string,
  tags: string[],
  sections: DailyBriefSection[],
};

export const DAILY_BRIEFS: DailyBrief[] = [
  {
    id: "2026-07-08",
    dateLabel: "July 8, 2026",
    dayLabel: "Today",
    title: "Search traffic is working better than social",
    summary: "Short notes on growth, new users, revenue, and suggested next steps.",
    readTime: "5 min read",
    tags: ["Growth", "Users", "Revenue"],
    sections: [
      {
        heading: "Executive summary",
        intro: "Quick read. The main changes are below.",
        blocks: [
          {
            type: "bullets",
            bullets: [
              {
                label: "Search is stronger",
                text: "Fewer visits than direct traffic. More sign-ups and first payments.",
              },
              {
                label: "Team invites matter",
                text: "Users who invited teammates finished setup faster.",
              },
              {
                label: "No urgent issue",
                text: "Email and payment health look normal today.",
              },
            ],
          },
        ],
      },
      {
        heading: "Core metric growth",
        blocks: [
          {
            type: "metrics",
            metrics: [
              { label: "Qualified sign-ups", value: "128", delta: "+18% vs last week", tone: "good" },
              { label: "Activated projects", value: "42", delta: "+11% vs last week", tone: "good" },
              { label: "First purchase revenue", value: "$675", delta: "+6% vs prior period", tone: "good" },
              { label: "Avg. setup time", value: "14m", delta: "-9% faster", tone: "good" },
            ],
          },
          {
            type: "visual",
            visual: {
              kind: "chart",
              title: "Setup by source",
              caption: "Mock chart: search users reach setup steps sooner than paid social users.",
            },
          },
          {
            type: "bullets",
            bullets: [
              {
                label: "Best search terms",
                text: "\"auth pricing calculator\" and \"B2B user management SDK\" convert 38% above average.",
              },
              {
                label: "Social is weaker",
                text: "Paid social brings visits, but fewer users finish setup.",
              },
            ],
          },
          {
            type: "suggestion",
            suggestion: {
              id: "increase-search-budget-auth-pricing",
              title: "Move budget to search",
              summary: "Increase budget for \"auth pricing calculator\" and \"B2B user management SDK\".",
              impact: "+12-18% expected good-fit sign-ups",
              actionLabel: "Apply suggestion",
            },
          },
        ],
      },
      {
        heading: "Important recent sign-ups",
        blocks: [
          {
            type: "users",
            users: [
              {
                name: "Maya Patel",
                email: "maya@northstar.dev",
                company: "Northstar Labs",
                signal: "Created a project. Invited 3 teammates. Viewed payments.",
              },
              {
                name: "Ethan Brooks",
                email: "ethan@arcforge.ai",
                company: "ArcForge AI",
                signal: "Came from Google. Read RBAC docs twice. Signed up.",
              },
              {
                name: "Sofia Nguyen",
                email: "sofia@cloudlane.co",
                company: "Cloudlane",
                signal: "Set up email templates. Sent a test email in 11 minutes.",
              },
            ],
          },
          {
            type: "bullets",
            bullets: [
              {
                label: "Follow up",
                text: "Prioritize accounts that invite teammates and view payments.",
              },
              {
                label: "Main drop-off",
                text: "Users still get stuck before adding a production domain.",
              },
            ],
          },
          {
            type: "suggestion",
            suggestion: {
              id: "launch-domain-setup-nudge",
              title: "Add domain setup nudge",
              summary: "Prompt new admins if no domain is added after 20 minutes.",
              impact: "+7% expected project activation",
              actionLabel: "Apply suggestion",
            },
          },
        ],
      },
      {
        heading: "Extra context",
        blocks: [
          {
            type: "visual",
            visual: {
              kind: "screenshot",
              title: "Landing page test",
              caption: "Mock image: add a short setup proof section near pricing.",
            },
          },
          {
            type: "bullets",
            bullets: [
              {
                label: "Revenue",
                text: "First purchases mostly come from accounts with multiple active users.",
              },
              {
                label: "Today",
                text: "Focus on search. Fix the domain setup drop-off.",
              },
            ],
          },
        ],
      },
    ],
  },
  {
    id: "2026-07-07",
    dateLabel: "July 7, 2026",
    dayLabel: "Yesterday",
    title: "Team invites helped users finish setup",
    summary: "Projects with early teammate invites were more active.",
    readTime: "4 min read",
    tags: ["Activation", "Teams"],
    sections: [
      {
        heading: "Brief",
        blocks: [
          {
            type: "bullets",
            bullets: [
              {
                label: "Invites helped",
                text: "Teams looked at roles, permissions, and email templates sooner.",
              },
              {
                label: "Make it early",
                text: "Ask for teammate invites earlier in setup.",
              },
            ],
          },
        ],
      },
      {
        heading: "Recommended follow-up",
        blocks: [
          {
            type: "suggestion",
            suggestion: {
              id: "promote-team-invite-onboarding",
              title: "Move team invite up",
              summary: "Show team invites earlier for new projects.",
              impact: "+9% expected week-one retention",
              actionLabel: "Apply suggestion",
            },
          },
        ],
      },
    ],
  },
  {
    id: "2026-07-06",
    dateLabel: "July 6, 2026",
    dayLabel: "Monday",
    title: "Email delivery is fine. Template setup needs help.",
    summary: "Delivery is stable. Some users edit templates but never send a test.",
    readTime: "3 min read",
    tags: ["Emails", "Retention"],
    sections: [
      {
        heading: "Brief",
        blocks: [
          {
            type: "metrics",
            metrics: [
              { label: "Delivered emails", value: "1.8k", delta: "+4%", tone: "good" },
              { label: "Bounce rate", value: "1.2%", delta: "flat", tone: "neutral" },
              { label: "Template stalls", value: "14", delta: "+22%", tone: "watch" },
            ],
          },
          {
            type: "bullets",
            bullets: [
              {
                label: "Delivery is fine",
                text: "No bounce spike today.",
              },
              {
                label: "Template setup stalls",
                text: "Some users edit templates but never send a test.",
              },
            ],
          },
        ],
      },
      {
        heading: "Recommended follow-up",
        blocks: [
          {
            type: "bullets",
            bullets: [
              {
                label: "UX nudge",
                text: "Show test-send after two template edits.",
              },
            ],
          },
        ],
      },
    ],
  },
  {
    id: "2026-07-03",
    dateLabel: "July 3, 2026",
    dayLabel: "Friday",
    title: "Pricing visitors want proof faster",
    summary: "Pricing visitors often check docs before signing up.",
    readTime: "4 min read",
    tags: ["Pricing", "Website"],
    sections: [
      {
        heading: "Brief",
        blocks: [
          {
            type: "visual",
            visual: {
              kind: "map",
              title: "Pricing to docs",
              caption: "Mock journey: users check setup effort before signing up.",
            },
          },
          {
            type: "bullets",
            bullets: [
              {
                label: "High intent",
                text: "Pricing visitors open setup docs more often.",
              },
              {
                label: "Missing proof",
                text: "Add setup proof near pricing.",
              },
            ],
          },
        ],
      },
      {
        heading: "Recommended follow-up",
        blocks: [
          {
            type: "suggestion",
            suggestion: {
              id: "add-pricing-implementation-proof",
              title: "Add setup proof",
              summary: "Add a short setup block to the pricing page.",
              impact: "+5% expected pricing-to-sign-up conversion",
              actionLabel: "Apply suggestion",
            },
          },
        ],
      },
    ],
  },
];

export const TODAYS_DAILY_BRIEF = DAILY_BRIEFS[0];

export function getAllDailyBriefSuggestions(): DailyBriefSuggestion[] {
  return DAILY_BRIEFS.flatMap((brief) => brief.sections.flatMap((section) => section.blocks.flatMap((block) => block.type === "suggestion" ? [block.suggestion] : [])));
}
