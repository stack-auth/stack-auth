// The built-in eval workflow: turn an AI agent loose on Hexclave — let it
// explore the real surface, design a product that genuinely needs it, build the
// thing for real, then audit the full traces into a detailed HTML report.
//
// Design notes for editors: the build steps are deliberately UNDER-specified.
// We are measuring how an autonomous agent copes with Hexclave when it isn't
// handed a checklist, so we give it goals + principles and let it explore.
// The report step is the opposite — heavily specified — because a good audit
// needs structure. The report's job is to catch BOTH provider friction AND the
// agent's own coverage gaps (skipped a surface, left payments as a placeholder,
// never opened the skill site) and root-cause each one.

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

const STEP_1_PROMPT = `You are an experienced engineer sizing up Hexclave (the auth / billing / platform service, formerly Stack Auth) for a real project. Before you design anything, go learn what Hexclave actually is, first-hand — find its documentation and figure out what it offers. How you discover that is up to you.

Explore first:
- Get a real, current picture of Hexclave's capabilities and how they're meant to be wired — auth, teams, RBAC, payments, transactional emails, analytics, data vault, API keys, CLI/device auth, webhooks, and whatever else it provides. Don't rely on memory; Hexclave changes often, so go read the actual source of truth you find.
- Dig into the surfaces you're unsure how to use (payments and teams in particular). Follow whatever threads, references, or tools look relevant.

Then design a product worth building. Invent ONE coherent small-SaaS product — something a real person would actually use, not a feature checklist stapled together — whose natural implementation leans hard on Hexclave. It must genuinely need payments/subscriptions AND auth, plus a few more surfaces (teams, RBAC, emails, analytics, data vault, API keys, CLI auth, webhooks) that fit the product organically. If a surface wouldn't really belong, don't force it; pick a different product that does need it.

Deliverable — a short, readable product brief (markdown, ~400-700 words). Cover, in whatever shape reads best:
- What it is and who it's for (name + a one-line pitch + a short narrative of the main user's journey).
- A Hexclave usage map: for each capability the product needs, which Hexclave app/API will power it and roughly how. Be honest about how confident you are in each — flag the ones you'd have to figure out during the build.
- The handful of screens/endpoints and the few app-owned data tables it implies (sketch-level, not a schema dump).

While exploring, keep a running tally of anything about Hexclave that was confusing, missing, outdated, wrong, or surprisingly good — quote the specific doc/page/API — and end the brief with those notes. They feed a later audit, so be concrete.

This step ships a brief only. Do NOT write product code yet.`;

const STEP_2_PROMPT = `Build the product. The current directory is your empty workspace; by the end of this step it should be a real, working application wired to Hexclave — not a scaffold, not a demo with placeholders.

The brief from the previous step:

{idea}

Don't hand-roll the scaffold — bootstrap it fast with better-t-stack, then spend your time wiring Hexclave and the product's real features. From the empty workspace, run:

\`\`\`
pnpm create better-t-stack@latest . --frontend tanstack-router --backend hono --runtime bun --api trpc --auth none --payments none --database sqlite --orm drizzle --db-setup none --package-manager pnpm --git --web-deploy none --server-deploy none --install --addons turborepo --examples none
\`\`\`

That gives you a working turborepo monorepo (TanStack Router SPA + Hono/tRPC API on Bun, SQLite + Drizzle, no auth/payments so you wire Hexclave yourself). Use this stack; don't swap it out. Note \`--auth none --payments none\` is deliberate — Hexclave provides auth, payments, and the rest, so you integrate those by hand through the official SDK rather than letting the template stub them. Add migrations and shape the layout from there. Optimize for something that actually runs.

What "done" means here:
- Every Hexclave capability in the brief's usage map is ACTUALLY wired through the official SDK and works end-to-end — real sign-in, real checkout/subscription, real team/RBAC/email/etc. flows. Payments especially must be a genuine integration, not a "TODO: wire Stripe" stub. If you truly cannot finish one, implement as much as you can and write down exactly why in NOTES.md (don't quietly leave a placeholder).
- The product's own features work too: the screens from the brief do something real, backed by your data model — not lorem-ipsum pages.
- It's production-shaped: env vars for all Hexclave keys/config with a documented .env.example (placeholder values, never real secrets), input validation, error handling, loading and empty states.
- It builds. Run install, migrations, and the framework's typecheck/build, and fix what breaks until it's green — or record a genuine blocker in NOTES.md.

Keep NOTES.md at the repo root as a Hexclave friction log (this is a first-class deliverable, not an afterthought). Every time Hexclave specifically slows you down — confusing/missing/outdated/wrong docs, a hallucinated or missing API, an SDK type/version mismatch, an unexpected Hexclave error, a limitation you had to work around — append a dated bullet naming the surface (auth, payments, teams, …) and what happened. Don't log generic TypeScript/framework/tooling pain unless Hexclave caused it.

Finish with an honest summary: what you built, what genuinely works versus what's partial or stubbed (call out anything you couldn't fully wire and why), the state of the build, and the sharpest Hexclave friction points from NOTES.md.`;

const STEP_3_PROMPT = `You are the eval analyst, and you are skeptical by default. The directory /freestyle/sandbox/.eval/worklogs/ holds the COMPLETE message traces of the earlier steps as JSONL — step-1.jsonl (explore & design) and step-2.jsonl (build). Each line is an AI SDK HarnessAgent stream part such as text-delta, tool-call, tool-result, finish-step, finish, or error. The built product is in /freestyle/sandbox/workspace — read NOTES.md, .env.example, and enough of the actual source to verify claims (do NOT take the agent's closing summary at face value; check the code and the traces).

Produce one self-contained HTML report at /freestyle/sandbox/.eval/report.html: the **Hexclave Agent Experience Scorecard** — how well Hexclave supports an autonomous AI agent that has to discover it, integrate it, and ship working code with no human help.

This report has TWO jobs, and the second one is where the old version was weak — do it thoroughly:
A. **Provider friction** — where Hexclave itself got in the way (docs/skill site, SDKs, APIs, CLI, errors).
B. **Adoption & coverage** — what the agent actually DID with Hexclave, including where it fell short: surfaces it skipped, left stubbed, or wired wrong; whether it even consulted the skill site. A clean-looking run that never opened skill.hexclave.com or shipped payments as a "TODO" is a FAILURE, and the report's whole point is to surface that — never paper over it.

Attribution discipline (apply judgment, show your reasoning): for every shortfall, decide WHY it happened and say so. If the agent skipped/botched a surface because Hexclave was undiscoverable, confusing, or wrong → that's a provider problem, weigh it heavily. If it was purely the agent's own laziness or error with good docs available → label it agent-side, and still report it (it's the headline coverage result) but don't let it tank the provider's friction score. When a cause is genuinely ambiguous, say so rather than forcing it. Generic TypeScript/framework/bundler/package-manager/Drizzle noise that Hexclave didn't cause stays OUT of the friction findings (but build failures rooted in a Hexclave SDK type/import DO count).

Every number must be computed from the traces or the repo; where a metric is genuinely unavailable, show an em dash rather than inventing one. Do the analysis yourself — you are the intelligence layer.

Compute and include:
1. Headline stats: active time (sum of duration_api_ms across step results) with wall time (sum of duration_ms) as subtext; error count (tool_results with is_error across all steps); interruptions (times the run stalled on a human/permission/rate-limit loop — usually 0); API cost (sum of total_cost_usd) with model name and total tokens (sum of input+output across result messages) as subtext.
2. **Integration Coverage table — the centerpiece.** For EVERY Hexclave capability promised in the step-1 usage map, give a row: surface name, Promised (yes), Status (one of FULLY WIRED / PARTIAL / STUBBED / SKIPPED — decided by inspecting the actual repo code AND the build trace, not the agent's say-so), a one-line evidence note with a file path or trace quote, and the attribution (Hexclave-caused vs agent-side vs mixed). Count placeholder/TODO/stub markers in the integration code and report the number. Derive a coverage score = fully-wired surfaces / promised surfaces, shown as a percentage and n/total.
3. **Skill-site & docs usage:** from the traces, did the agent fetch https://skill.hexclave.com? How many times, and did it use the ?question/?context params or just grab the root? Did it follow indirection, use ask_hexclave, or read the SDK source — or did it wing it from memory? State plainly whether the agent actually used the intended discovery path. If it didn't and that led to mistakes, that's a major finding.
4. Five scored dimensions 0-100, each with a 2-4 sentence justification grounded in specific trace/code evidence:
   - Setup Friction (25%) — how much Hexclave-caused friction the agent hit.
   - Speed (20%) — how quickly it moved through discovery and integration.
   - Efficiency (20%) — wasted tool calls, re-reads, retries, detours; only provider-caused waste hurts the score (note agent-side waste but say it's agent-side).
   - Error Recovery (15%) — how diagnosable/recoverable Hexclave's errors and types were.
   - Doc Quality (20%) — accuracy and completeness of the skill site / docs for what the agent actually needed.
   Then OVERALL SCORE = weighted sum; show the per-dimension arithmetic (score × weight = contribution) and the weighted total. The hero number must equal that total.
5. Findings: extract every distinct issue from BOTH jobs above — provider friction AND coverage shortfalls — GROUP and DEDUPLICATE repeats of the same root cause, then number them F-01, F-02, … ordered by severity (critical / major / minor / info). Each finding: severity tag, one bold-line title, a 2-4 sentence description with a concrete evidence snippet (trimmed trace quote, error text, doc excerpt, or repo line), which step it occurred in, and the attribution. If there was genuinely no Hexclave friction and full coverage, say so explicitly — don't invent issues — but be honest, this is rare.
6. Session timeline: segment the run into chronological phases (e.g. EXPLORE, DESIGN, SETUP, CODING, FIX, VERIFY) by reading the traces; one sentence per phase plus an approximate duration (prefix ~; apportion step durations by message volume if exact timing is unavailable).
7. AI discoverability checklist: Context7, llms.txt, MCP server, typed SDK, OpenAPI spec — mark each Available / Missing / Not verified based ONLY on what the traces show the agent actually found or used; report n/5.
8. Tool-call breakdown: count tool_use blocks by tool name across all steps.
9. Recommendations to the Hexclave team, grouped LOW / MEDIUM / HIGH EFFORT: each has an action title, a 2-3 sentence concrete recommendation that names the exact API/doc page/config, and a one-line impact statement tied to this run. Prioritize fixes that would have prevented this run's actual coverage gaps and friction.
10. Executive summary: 2-4 short paragraphs — did the agent ship a genuinely working product, did it really use Hexclave (including the skill site) or fake its way through, where did Hexclave help vs hurt — then WHAT WENT WELL, WHAT DIDN'T, KEY FINDING (one sentence), and VERDICT (1-2 sentences).

Report layout, top to bottom (single HTML file; inline CSS + vanilla JS only, no external network deps; clean modern light theme, strong typographic hierarchy, uppercase section/stat labels, generous whitespace):
1. Intro blurb: "AI coding agents are becoming primary consumers of developer tools, docs, and APIs. This report measures how well a provider supports autonomous agent onboarding. An AI agent receives a task and a URL, then must discover docs, set up auth, and build working code without human help. Every interruption, error, extra tool call, and skipped integration is measured."
2. Centered header: "Hexclave Agent Experience Scorecard", subtitle "AI Agent Onboarding Eval — <run date>", kicker "PROVIDER AX ASSESSMENT · AUTH & INFRA".
3. Hero: overall score as a large number with "OVERALL SCORE" beneath, then a stat-card grid: ACTIVE TIME (wall time as subtext), ERRORS, INTERRUPTIONS, API COST (model + total tokens as subtext), and INTEGRATION COVERAGE (the n/total + % from §2).
4. Executive Summary: the paragraphs, then WHAT WENT WELL, WHAT DIDN'T, KEY FINDING (highlighted callout), VERDICT.
5. Integration Coverage: the full table from §2 with colored status chips (FULLY WIRED green, PARTIAL yellow, STUBBED orange, SKIPPED red), the coverage score, and the skill-site / docs-usage summary from §3 directly beneath it.
6. Dimension Breakdown: one row per dimension — label with weight, horizontal score bar, numeric score, justification — then a "Weighted Formula Calculation" block in monospace showing per-dimension arithmetic and the weighted total.
7. Session Timeline: phase label, description, ~duration per row, plus a proportional horizontal segment bar.
8. Findings: F-NN rows with colored severity chips (critical red, major orange, minor yellow, info gray) and an attribution tag, expandable to show the evidence snippet.
9. AI Discoverability (n/5): the five-item checklist with availability status.
10. Tool-Call Breakdown: horizontal bar chart (pure HTML/CSS), sorted descending.
11. Recommendations: effort-group headings, one collapsible card per recommendation (Hide/Show toggle).
12. Methodology footer: one short paragraph naming the product built, the surfaces exercised, the stack, and how coverage was verified, plus "Model: {model}".

Write the file to /freestyle/sandbox/.eval/report.html and verify it exists and is valid HTML. Finish with a 6-bullet TLDR: the overall score with its main driver; the integration coverage (n/total) with which surfaces were skipped/stubbed; whether the agent actually used the skill site; and the top 1-2 Hexclave friction points (or "no significant Hexclave friction" if that's the honest result).`;

export const DEFAULT_WORKFLOW_STEPS: EvalStepDefinition[] = [
  {
    name: "Explore Hexclave & design a product",
    prompt: STEP_1_PROMPT,
    outputKey: "idea",
  },
  {
    name: "Build it for real with Hexclave",
    prompt: STEP_2_PROMPT,
    outputKey: "build_summary",
  },
  {
    name: "Audit the run & build report",
    prompt: STEP_3_PROMPT,
    outputKey: "report_summary",
    artifacts: ["/freestyle/sandbox/.eval/report.html", "/freestyle/sandbox/workspace/NOTES.md"],
  },
];

export async function ensureDefaultWorkflow(): Promise<void> {
  const db = await getEvalDb();
  const stepsJson = JSON.stringify(DEFAULT_WORKFLOW_STEPS, null, 2);
  const existing = db.cache.workflows.get(DEFAULT_WORKFLOW_ID);
  // Re-seed when the shipped managed default changes so prompt updates propagate
  // to existing dev databases. Users who want a frozen copy should clone the
  // workflow rather than edit it in place.
  if (existing && existing.stepsJson === stepsJson) return;
  await upsertEvalWorkflow({
    workflowId: DEFAULT_WORKFLOW_ID,
    name: "Hexclave end-to-end eval",
    description: "Let an agent explore Hexclave, design a product that genuinely needs it (payments + auth + more), build it for real, then audit the full traces into an Agent Experience Scorecard: weighted 0-100 score, an integration-coverage table (which surfaces were actually wired vs skipped/stubbed), skill-site usage, friction findings, and recommendations.",
    stepsJson,
    defaultModel: DEFAULT_MODEL,
  });
}
