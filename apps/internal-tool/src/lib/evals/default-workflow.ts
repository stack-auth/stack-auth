// The built-in eval workflow: dream up a Hexclave-heavy product, scaffold it,
// implement it with Hexclave, then turn the full agent traces into an HTML
// report. Seeded on first use; users can edit or clone it from the UI.

import type { EvalStepDefinition } from "./types";
import { getEvalDb, upsertEvalWorkflow } from "./stdb";

export const DEFAULT_WORKFLOW_ID = "default-hexclave-eval";
export const DEFAULT_MODEL = "anthropic/claude-sonnet-4.6";

// One of these is picked at random per run and exposed to prompts as {framework}.
export const FRAMEWORK_CHOICES = [
  "TanStack Start",
  "TanStack Router (SPA, Vite)",
  "React (Vite SPA)",
  "Next.js (App Router)",
  "Vue 3 (Vite)",
  "Angular",
  "plain HTML + CSS + vanilla JS (Vite static frontend with a small Node API)",
  "FastAPI + HTMX",
] as const;

const STEP_1_PROMPT = `You are designing a realistic product to stress-test Hexclave (the auth/billing/platform service, formerly Stack Auth).

Think of ONE concrete user story / product idea for a small SaaS app whose implementation will exercise as many Hexclave apps and surfaces as reasonably fit together. Pick a coherent product (not a feature checklist) that naturally needs at least 5 of these:
- Authentication (email/password, OAuth, magic links)
- Teams & invitations
- RBAC / permissions
- Payments & subscriptions
- Transactional emails
- Analytics / event tracking
- Data vault (secure secret storage per user/team)
- API keys (user- or team-scoped)
- CLI auth (device flow for a companion CLI)
- Webhooks

Write your final answer as a compact product spec in markdown with these sections:
1. **Product name and one-line pitch**
2. **User story** — a narrative of a primary user's journey through the product
3. **Hexclave usage map** — bullet list mapping each product capability to the Hexclave app/API it will use
4. **Pages/routes** — the 4-8 screens or endpoints the app needs
5. **Data model sketch** — the 3-6 SQLite tables the app itself owns (beyond what Hexclave manages)

Keep the whole spec under 600 words. The spec is the only deliverable of this step; later steps will scaffold and implement it. Do not write any code yet.

If at any point you consult Hexclave's docs or skill site (skill.hexclave.com) and hit friction — something confusing, missing, outdated, or wrong — call it out explicitly in your answer so it can be reviewed later.`;

const STEP_2_PROMPT = `You are scaffolding a brand-new monorepo in the current directory (it is empty; it is your workspace).

Product spec from the previous step:

{idea}

Scaffold a production-shaped monorepo for this product with EXACTLY this stack:
- pnpm workspaces + Turborepo
- SQLite as the database, accessed via Drizzle ORM (drizzle-kit for migrations)
- Frontend framework: {framework} — do NOT substitute a different framework
- TypeScript everywhere it applies (use idiomatic Python typing instead if the framework is FastAPI-based)

Requirements:
1. Layout: apps/web (the {framework} app), apps/api if the framework needs a separate backend, packages/db (Drizzle schema + migrations + client), packages/config (shared tsconfig/eslint where applicable). Adjust pragmatically for the framework, but keep it a real Turborepo with a root turbo.json and pnpm-workspace.yaml.
2. Implement the data model sketch from the spec as a Drizzle schema in packages/db and generate an initial migration.
3. Add placeholder pages/routes for each screen in the spec rendering static placeholder content.
4. A README.md documenting the repo layout, how to install, migrate, and run dev.
5. Make sure 'pnpm install' succeeds and the dev build compiles (run the framework's build or typecheck command and fix what breaks). Do NOT integrate Hexclave yet — that's the next step.

Finish with a short summary of the layout you created and any deviations you had to make.

If at any point you consult Hexclave's docs or skill site (skill.hexclave.com) and hit friction — something confusing, missing, outdated, or wrong — call it out explicitly in your summary so it can be reviewed later.`;

const STEP_3_PROMPT = `The current directory contains a scaffolded monorepo (see README.md) for this product:

{idea}

Your job: implement the product end-to-end and make it production-ready with Hexclave (the auth/billing/platform service, formerly Stack Auth).

Before writing integration code, learn the current Hexclave surface:
- Fetch https://skill.hexclave.com (e.g. 'curl -sSL https://skill.hexclave.com') for the canonical agent skill/setup instructions, and re-fetch with '?question=...&context=...' query params whenever you are unsure about a specific API.
- Prefer those docs over memory; Hexclave changes frequently.

Requirements:
1. Wire up every Hexclave capability listed in the spec's "Hexclave usage map" (auth, teams, RBAC, payments, emails, analytics, data vault, API keys, CLI auth, webhooks — whichever apply) using the official SDK(s) where available.
2. Implement the real app features behind them (replace placeholder pages with working UI; wire the Drizzle/SQLite data model to real flows).
3. Use environment variables for all Hexclave keys/config; provide .env.example with every variable documented. Use placeholder values; do not invent real secrets.
4. Production hardening: input validation, error handling, loading states, sensible empty states.
5. Keep a running engineering log in NOTES.md at the repo root, scoped to Hexclave ONLY: every time you hit friction caused by Hexclave (confusing/missing/outdated docs, missing or hallucinated API, unexpected Hexclave error, workaround for a Hexclave limitation, SDK/type/version issue), append a dated bullet with the Hexclave surface (auth, payments, teams, etc.) and details. Do NOT log generic TypeScript/framework/build/tooling problems here unless Hexclave directly caused them. This Hexclave friction log is a first-class deliverable.
6. Verify the build: run install, migrations, typecheck/build, and fix failures until green (or document blockers in NOTES.md if truly unresolvable).

Finish with a summary of what you implemented, what works, what is stubbed, and the top 5 friction points from NOTES.md.`;

const STEP_4_PROMPT = `You are the eval analyst. The directory /vercel/sandbox/.eval/worklogs/ contains the COMPLETE message traces of the previous agent steps as JSONL files (step-1.jsonl, step-2.jsonl, step-3.jsonl). Each line is a Claude Code stream-json message: system events, assistant messages (including reasoning and tool_use blocks), user messages carrying tool_results, and final result messages. The implemented repo is in /vercel/sandbox/workspace (NOTES.md and .env.example there are key inputs too).

Produce a single, self-contained HTML report at /vercel/sandbox/.eval/report.html. The report has ONE job: surface the **Hexclave-specific friction** the agent hit while building on Hexclave (the auth/billing/platform service, formerly Stack Auth).

CRITICAL SCOPE — only Hexclave blockers, from any step:
- INCLUDE only issues caused by Hexclave itself: its docs / skill site (skill.hexclave.com), its SDK(s), its APIs, and integrating its capabilities (auth, teams, RBAC, payments, transactional emails, analytics, data vault, API keys, CLI auth, webhooks). Examples: confusing / missing / outdated / wrong docs, hallucinated or non-existent Hexclave APIs, SDK type or version mismatches, unclear setup/config, unexpected Hexclave errors, DX papercuts, having to work around a Hexclave limitation.
- Scan the worklogs from ALL steps (step-1, step-2, step-3) AND NOTES.md. A Hexclave blocker can appear at ANY stage — ideation, scaffolding, or implementation — not just the implementation step. Attribute each blocker to the step where it actually occurred.
- EXCLUDE everything not caused by Hexclave: generic TypeScript / framework / build / bundler / package-manager errors, Drizzle/SQLite issues, the agent's own mistakes or typos, and general tooling noise. The ONLY exception is when the issue was directly caused by Hexclave (e.g. a build break from a Hexclave SDK type, or a wrong import the agent copied from Hexclave docs) — then include it and say so. When in doubt, EXCLUDE. A short, high-signal report of real Hexclave friction is the goal; do not pad it with generic engineering blockers.

Analysis requirements (do this yourself, with judgment — you are the intelligence layer):
1. Parse all worklogs + NOTES.md and pull out every Hexclave-caused friction point per the scope above.
2. GROUP and DEDUPLICATE: merge repeated occurrences of the same underlying Hexclave issue, count occurrences, keep representative evidence snippets (trimmed tool calls / error output / doc quotes).
3. Categorize each by Hexclave surface ("Docs / skill site", "SDK", "Auth", "Teams & RBAC", "Payments", "Emails", "Analytics", "Data vault", "API keys", "CLI auth", "Webhooks", "Other Hexclave") and assign severity (blocker / major / minor / info) plus which step it occurred in.
4. Compute light summary stats scoped to context: number of distinct Hexclave blockers by severity and by step; messages/tool-calls per step for context; cost if present in result messages.
5. Write a short executive summary: did the agent ship the product, and specifically where did Hexclave help vs. where did it hurt? If a step had no Hexclave friction, say so explicitly rather than inventing issues.

Report requirements (single HTML file, no external network dependencies; inline CSS + vanilla JS):
- Clean, modern, readable design; light theme; good typography.
- Executive summary at top, then stat cards, then the Hexclave-friction issues table.
- ADVANCED FILTERS implemented client-side in JS: free-text search, and filter chips/dropdowns for Hexclave surface (category), severity, and step; filters combine; show live result count.
- Each issue row expands to show its evidence snippets and your suggested fix / recommendation to the Hexclave team.
- A per-step timeline section noting, for each step, whether any Hexclave friction occurred and the key numbers.

Write the file to /vercel/sandbox/.eval/report.html and verify it exists and is valid HTML. Finish with a 5-bullet TLDR focused on the top Hexclave friction points (or "no significant Hexclave friction" if that's the honest result).`;

export const DEFAULT_WORKFLOW_STEPS: EvalStepDefinition[] = [
  {
    name: "Think of a user story",
    prompt: STEP_1_PROMPT,
    outputKey: "idea",
  },
  {
    name: "Template the monorepo",
    prompt: STEP_2_PROMPT,
    outputKey: "scaffold_summary",
  },
  {
    name: "Implement with Hexclave",
    prompt: STEP_3_PROMPT,
    outputKey: "implementation_summary",
  },
  {
    name: "Analyze logs & build report",
    prompt: STEP_4_PROMPT,
    outputKey: "report_summary",
    artifacts: ["/vercel/sandbox/.eval/report.html", "/vercel/sandbox/workspace/NOTES.md"],
  },
];

export async function ensureDefaultWorkflow(): Promise<void> {
  const db = await getEvalDb();
  const stepsJson = JSON.stringify(DEFAULT_WORKFLOW_STEPS, null, 2);
  const existing = db.cache.workflows.get(DEFAULT_WORKFLOW_ID);
  // Re-seed when the shipped managed default changes so prompt updates (e.g. the
  // Hexclave-only friction scoping) propagate to existing dev databases. Users
  // who want a frozen copy should clone the workflow rather than edit it in place.
  if (existing && existing.stepsJson === stepsJson) return;
  await upsertEvalWorkflow({
    workflowId: DEFAULT_WORKFLOW_ID,
    name: "Hexclave end-to-end eval",
    description: "Invent a Hexclave-heavy product, scaffold a turborepo (random framework, SQLite + Drizzle), implement it prod-ready with Hexclave, then generate an HTML report of the Hexclave-specific friction hit across all steps.",
    stepsJson,
    defaultModel: DEFAULT_MODEL,
  });
}
