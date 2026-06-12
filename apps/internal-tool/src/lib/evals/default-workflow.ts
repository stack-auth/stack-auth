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

const STEP_4_PROMPT = `You are the eval analyst. The directory /vercel/sandbox/.eval/worklogs/ contains the COMPLETE message traces of the previous agent steps as JSONL files (step-1.jsonl, step-2.jsonl, step-3.jsonl). Each line is a Claude Code stream-json message: system events, assistant messages (including reasoning and tool_use blocks), user messages carrying tool_results, and final result messages (which carry duration_ms, duration_api_ms, total_cost_usd, usage and num_turns). The implemented repo is in /vercel/sandbox/workspace (NOTES.md and .env.example there are key inputs too).

Produce a single, self-contained HTML report at /vercel/sandbox/.eval/report.html: the **Hexclave Agent Experience Scorecard** — an assessment of how well Hexclave (the auth/billing/platform service, formerly Stack Auth) supports autonomous AI-agent onboarding, measured from this run's traces.

CRITICAL SCOPE for findings — only Hexclave friction, from any step:
- INCLUDE only issues caused by Hexclave itself: its docs / skill site (skill.hexclave.com), its SDK(s), its APIs, its CLI, and integrating its capabilities (auth, teams, RBAC, payments, transactional emails, analytics, data vault, API keys, CLI auth, webhooks). Examples: confusing / missing / outdated / wrong docs, hallucinated or non-existent Hexclave APIs, SDK type or version mismatches, unclear setup/config, unexpected Hexclave errors, DX papercuts, having to work around a Hexclave limitation.
- Scan the worklogs from ALL steps (step-1, step-2, step-3) AND NOTES.md. A Hexclave blocker can appear at ANY stage — ideation, scaffolding, or implementation. Attribute each to the step where it actually occurred.
- EXCLUDE everything not caused by Hexclave: generic TypeScript / framework / build / bundler / package-manager errors, Drizzle/SQLite issues, the agent's own mistakes or typos, and general tooling noise. The ONLY exception is when the issue was directly caused by Hexclave (e.g. a build break from a Hexclave SDK type, or a wrong import the agent copied from Hexclave docs) — then include it and say so. When in doubt, EXCLUDE.

Analysis requirements (do this yourself, with judgment — you are the intelligence layer). Every number in the report must be computed from the traces; where a metric is genuinely unavailable, show an em dash rather than inventing a value:
1. Headline stats: active time (sum of duration_api_ms across step results) and wall time (sum of duration_ms); error count (tool_results with is_error across all steps); interruption count (times the run stalled waiting on a human, permission, or rate-limit/retry loop — usually 0); API cost (sum of total_cost_usd) with the model name and total tokens (sum input+output across all result messages).
2. Score 5 dimensions 0-100, each with a 2-4 sentence justification grounded in trace evidence: Setup Friction (25%) — how much Hexclave-caused friction the agent hit; Speed (20%) — how quickly it moved through onboarding and integration; Efficiency (20%) — wasted tool calls, re-reads, retries, detours (only provider-caused waste should hurt the score; note agent-side waste but say it's agent-side); Error Recovery (15%) — how well errors could be diagnosed and recovered from given Hexclave's types/errors/docs; Doc Quality (20%) — accuracy and completeness of docs/skill site for what the agent actually needed.
3. Compute the OVERALL SCORE as the weighted sum and show the arithmetic per dimension (score x weight = contribution, then the weighted total). The hero number must equal the computed total.
4. Findings: extract every Hexclave-caused friction point, GROUP and DEDUPLICATE repeated occurrences of the same underlying issue, then number them F-01, F-02, ... ordered by severity (critical / major / minor / info). Each finding: severity tag, one-bold-line title, 1-3 sentence description, and which step it occurred in. If there was no Hexclave friction, say so explicitly rather than inventing issues.
5. Session timeline: segment the run into chronological phases (e.g. RESEARCH, SETUP, CODING, FIX, VERIFY) by reading the traces; for each phase give a one-sentence description of what happened and an approximate duration (prefix with ~; apportion step durations across phases by message volume if exact timing is unavailable).
6. AI discoverability checklist: Context7, llms.txt, MCP server, typed SDK, OpenAPI spec — mark each Available / Missing / Not verified based ONLY on what the traces show the agent actually found or used; report the resulting n/5.
7. Tool call breakdown: count tool_use blocks by tool name across all steps.
8. Recommendations to the Hexclave team, grouped by effort (LOW EFFORT / MEDIUM EFFORT / HIGH EFFORT): each has an action title, a 2-3 sentence concrete recommendation (name the exact API/doc page/config), and a closing one-line impact statement tying it back to this eval.
9. Executive summary: 2-4 short paragraphs — did the agent ship the product, where did Hexclave help vs. hurt — followed by WHAT WENT WELL (one short paragraph), WHAT DIDN'T (one short paragraph), KEY FINDING (one sentence), and VERDICT (1-2 sentence overall judgment).

Report layout, top to bottom (single HTML file; inline CSS + vanilla JS only, no external network dependencies; clean modern light theme, strong typographic hierarchy, uppercase section/stat labels, generous whitespace):
1. Intro blurb: "AI coding agents are becoming primary consumers of developer tools, docs, and APIs. This report measures how well a provider supports autonomous agent onboarding. An AI agent receives a task and a URL, then must discover docs, set up auth, and build working code without human help. Every interruption, error, and extra tool call is measured."
2. Centered header: "Hexclave Agent Experience Scorecard", subtitle "AI Agent Onboarding Eval — <run date>", kicker "PROVIDER AX ASSESSMENT · AUTH & INFRA".
3. Hero: the overall score as a large number with "OVERALL SCORE" beneath, then a 2x2 stat-card grid: ACTIVE TIME (wall time as subtext), ERRORS, INTERRUPTIONS, API COST (model name and total tokens as subtext).
4. Executive Summary section: the paragraphs, then WHAT WENT WELL, WHAT DIDN'T, KEY FINDING (visually highlighted callout), VERDICT.
5. Dimension Breakdown: one row per dimension — label with weight, horizontal score bar, numeric score, justification paragraph — followed by a "Weighted Formula Calculation" block showing the per-dimension arithmetic and the weighted total in monospace.
6. Session Timeline: phase label, description, ~duration per row, plus a proportional horizontal segment bar of the phases.
7. Findings: F-NN rows with colored severity chips (critical red, major orange, minor yellow, info gray), expandable to show evidence snippets (trimmed tool calls / error output / doc quotes).
8. AI Discoverability (n/5): the five-item checklist with availability status.
9. Tool Call Breakdown: horizontal bar chart (pure HTML/CSS) of tool call counts, sorted descending.
10. Recommendations: effort-group headings, then one collapsible card per recommendation (with a Hide/Show toggle).
11. Methodology footer: one short paragraph naming the product built, the surfaces exercised, and the stack, plus "Model: {model}".

Write the file to /vercel/sandbox/.eval/report.html and verify it exists and is valid HTML. Finish with a 5-bullet TLDR: the overall score with its main driver, then the top Hexclave friction points (or "no significant Hexclave friction" if that's the honest result).`;

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
    description: "Invent a Hexclave-heavy product, scaffold a turborepo (random framework, SQLite + Drizzle), implement it prod-ready with Hexclave, then generate an Agent Experience Scorecard HTML report: weighted 0-100 score, stat cards, session timeline, Hexclave friction findings, and recommendations.",
    stepsJson,
    defaultModel: DEFAULT_MODEL,
  });
}
