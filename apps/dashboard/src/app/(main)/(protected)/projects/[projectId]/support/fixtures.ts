export type DemoChannel = "slack" | "whatsapp" | "imessage" | "telegram" | "discord" | "email" | "web" | "sms";
export type DemoSender = "customer" | "agent" | "ai" | "system";
export type DemoMessageKind = "text" | "auto-reply" | "status" | "devin-video";
export type DemoPriority = "urgent" | "high" | "normal";
export type DemoAiState = "intake" | "standing-by" | "auto-replied" | "held-for-incident" | "resolved";
export type DossierField = "identity" | "plan" | "authEvents" | "replay" | "pastTickets";

export type DemoMessage = {
  id: string,
  sender: DemoSender,
  kind: DemoMessageKind,
  body: string,
  at: string,
};

export type DemoTimelineEntry = {
  id: string,
  kind: "event" | "span" | "message",
  label: string,
  at: string,
  detail?: string,
  tone: "ok" | "warn" | "error" | "neutral",
};

export type DemoDossier = {
  userId: string,
  email: string,
  plan: string,
  signedUpAgo: string,
  authEvents: string[],
  replay: { id: string, label: string, duration: string } | null,
  pastTickets: { subject: string, resolvedAgo: string }[],
};

export type PlaybackStep =
  | { kind: "wait", ms: number }
  | { kind: "typing", sender: DemoSender }
  | { kind: "message", message: DemoMessage }
  | { kind: "confidence", to: number }
  | { kind: "dossier", field: DossierField }
  | { kind: "draft", text: string }
  | { kind: "incident-trip" };

export type CopilotToolCall = {
  toolName: string,
  args: Record<string, string | number | boolean>,
  result: unknown,
};

export type CopilotTurn = {
  toolCalls?: CopilotToolCall[],
  text: string,
};

/**
 * A write-action the agent can execute (refund, re-run sync, plan change,
 * status-page publish, ...). Triggered when the operator's message contains
 * one of the keywords; `threadEffect` posts a status line into the customer
 * thread so the mutation is visible outside the copilot.
 */
export type CopilotAction = {
  triggers: string[],
  /** Shown on the pending-approval card; the mutation only runs after the operator approves. */
  approval: { title: string, summary: string },
  turn: CopilotTurn,
  threadEffect?: string,
};

export type CopilotScript = {
  initial: CopilotTurn,
  responses: CopilotTurn[],
  actions?: CopilotAction[],
  fallback: string,
};

export type DemoConversation = {
  id: string,
  channel: DemoChannel,
  customer: { name: string, company: string, hue: number },
  subject: string,
  preview: string,
  minutesAgo: number,
  unread: boolean,
  priority: DemoPriority,
  aiState: DemoAiState,
  confidence: number,
  clusterId?: string,
  /** Messages visible before any script runs. Scripted conversations start (nearly) empty. */
  seedMessages: DemoMessage[],
  script?: PlaybackStep[],
  /** Pre-filled reply draft for non-scripted conversations. */
  initialDraft?: string,
  dossier: DemoDossier,
  timeline: DemoTimelineEntry[],
  copilot: CopilotScript,
  docsSuggestion?: { title: string, reason: string, removed: string[], added: string[] },
  devinSuggested?: boolean,
};

export type DemoIncident = {
  id: string,
  title: string,
  reportCount: number,
  windowMinutes: number,
  clusterId: string,
  statusDraft: string,
  heldConversationIds: string[],
};

export type DemoCluster = {
  id: string,
  label: string,
  conversationIds: string[],
};

export const CHANNEL_LABELS: Record<DemoChannel, string> = {
  slack: "Slack",
  whatsapp: "WhatsApp",
  imessage: "iMessage",
  telegram: "Telegram",
  discord: "Discord",
  email: "Email",
  web: "Web chat",
  sms: "SMS",
};

// Customer-facing copy never exposes internals (webhooks, sync jobs, tools).
// The root cause lives in the copilot pane and dossier, for the team only.
const PAYMENTS_INTAKE_DRAFT = "Hi Maya — thanks for your patience, and sorry for the confusion. We found the issue on our side and fixed it; your workspace should show Pro within a minute. Your payment went through correctly and there's nothing you need to do. Let us know if anything still looks off!";

export const DEMO_CONVERSATIONS: DemoConversation[] = [
  {
    id: "conv-payments",
    channel: "slack",
    customer: { name: "Maya Chen", company: "Northstar Labs", hue: 262 },
    subject: "Payment succeeded but seat not upgraded",
    preview: "We paid for the Pro upgrade but the account still shows starter.",
    minutesAgo: 3,
    unread: true,
    priority: "urgent",
    aiState: "intake",
    confidence: 74,
    clusterId: "billing-upgrade",
    seedMessages: [],
    script: [
      { kind: "wait", ms: 600 },
      { kind: "message", message: { id: "pm1", sender: "customer", kind: "text", body: "We paid for the Pro upgrade but the account still shows starter. Checkout said it succeeded.", at: "10:41" } },
      { kind: "wait", ms: 900 },
      { kind: "typing", sender: "ai" },
      { kind: "wait", ms: 1600 },
      { kind: "message", message: { id: "pm2", sender: "ai", kind: "text", body: "Sorry about that — let me gather the details so the team can fix this quickly. Could you share the transaction id from your receipt, and the workspace slug?", at: "10:41" } },
      { kind: "confidence", to: 22 },
      { kind: "wait", ms: 2200 },
      { kind: "typing", sender: "customer" },
      { kind: "wait", ms: 1800 },
      { kind: "message", message: { id: "pm3", sender: "customer", kind: "text", body: "txn_9bc1f2 — workspace is northstar-prod.", at: "10:42" } },
      { kind: "wait", ms: 700 },
      { kind: "dossier", field: "identity" },
      { kind: "typing", sender: "ai" },
      { kind: "wait", ms: 1000 },
      { kind: "dossier", field: "plan" },
      { kind: "confidence", to: 51 },
      { kind: "wait", ms: 1000 },
      { kind: "dossier", field: "authEvents" },
      { kind: "wait", ms: 900 },
      { kind: "message", message: { id: "pm4", sender: "ai", kind: "text", body: "Thanks, that's everything I need. Your payment did go through, so no need to worry there. I've passed this to the team with everything they need and someone will follow up with you shortly.", at: "10:43" } },
      { kind: "dossier", field: "replay" },
      { kind: "dossier", field: "pastTickets" },
      { kind: "confidence", to: 74 },
      { kind: "wait", ms: 500 },
      { kind: "message", message: { id: "pm5", sender: "system", kind: "status", body: "AI handed off to the team with full context — confidence 74%, below the 90% auto-reply threshold", at: "10:43" } },
      { kind: "draft", text: PAYMENTS_INTAKE_DRAFT },
    ],
    dossier: {
      userId: "user_8YgQm",
      email: "maya@northstarlabs.dev",
      plan: "Starter (Pro upgrade pending)",
      signedUpAgo: "14 months ago",
      authEvents: ["Signed in via Google · 10:36", "checkout.completed · 10:38", "stripe.webhook.retry ×3 · 10:39", "entitlement.sync failed (502) · 10:39"],
      replay: { id: "rpl_3ka92", label: "Checkout session, rage-clicks on plan badge", duration: "5m 44s" },
      pastTickets: [{ subject: "Invite emails going to spam", resolvedAgo: "3 months ago" }],
    },
    timeline: [
      { id: "pt1", kind: "event", label: "checkout.completed", at: "10:38", detail: "plan=pro seats=12", tone: "ok" },
      { id: "pt2", kind: "span", label: "POST /payments/checkout", at: "10:38", detail: "214ms", tone: "ok" },
      { id: "pt3", kind: "span", label: "stripe.webhook.apply", at: "10:39", detail: "3.8s · retried ×3", tone: "warn" },
      { id: "pt4", kind: "span", label: "entitlements.sync", at: "10:39", detail: "502 Bad Gateway", tone: "error" },
      { id: "pt5", kind: "event", label: "plan badge rage-clicks", at: "10:40", detail: "from session replay", tone: "warn" },
      { id: "pt6", kind: "message", label: "Reached out on Slack", at: "10:41", tone: "neutral" },
    ],
    copilot: {
      initial: {
        toolCalls: [
          {
            toolName: "sql-query",
            args: { query: "SELECT status, amount, webhook_state FROM payments WHERE transaction_id = 'txn_9bc1f2'" },
            result: { success: true, rowCount: 1, result: [{ status: "succeeded", amount: "$1,188.00", webhook_state: "retrying", entitlement_sync: "failed_502" }] },
          },
          {
            toolName: "find-replay",
            args: { userId: "user_8YgQm", around: "checkout.completed" },
            result: { success: true, rowCount: 1, result: [{ replayId: "rpl_3ka92", window: "10:37–10:43", signal: "rage-clicks on plan badge after checkout" }] },
          },
          {
            toolName: "read-docs",
            args: { query: "entitlement sync failure after webhook retry" },
            result: { success: true, rowCount: 2, result: [{ page: "Billing / Webhooks", section: "Retry semantics" }, { page: "Runbooks / Entitlements", section: "Manual re-sync" }] },
          },
        ],
        text: "The payment is fine — `txn_9bc1f2` charged $1,188 successfully. The failure is downstream: Stripe's webhook retried 3 times and the entitlement sync 502'd, so the plan never flipped to Pro. The replay shows Maya rage-clicking the plan badge right after checkout.\n\nA manual re-sync from the entitlements runbook fixes her account immediately — tell me to \"re-run the sync\" and I'll do it. A customer-safe reply (no internals) is drafted in the composer; Maya was only told that her payment is fine and the team is on it.",
      },
      responses: [
        {
          toolCalls: [
            {
              toolName: "sql-query",
              args: { query: "SELECT count(*) FROM payments WHERE webhook_state = 'retrying' AND created_at > now() - interval '24 hours'" },
              result: { success: true, rowCount: 1, result: [{ count: 7 }] },
            },
          ],
          text: "7 other payments hit the same retrying state in the last 24h — this is systemic, not just Maya. Worth flagging to the billing team; I can group these into one cluster and hold a canonical reply if more reports come in.",
        },
      ],
      actions: [
        {
          triggers: ["resync", "re-sync", "re-run", "rerun", "fix it", "fix the", "apply the upgrade"],
          approval: {
            title: "Re-run entitlement sync",
            summary: "Workspace northstar-prod · apply the paid Pro upgrade (12 seats) from txn_9bc1f2",
          },
          turn: {
            toolCalls: [
              {
                toolName: "entitlements.resync",
                args: { workspace: "northstar-prod", transactionId: "txn_9bc1f2", dryRun: false },
                result: { success: true, rowCount: 1, result: [{ workspace: "northstar-prod", plan: "pro", seats: 12, synced_at: "just now" }] },
              },
            ],
            text: "Done — I re-ran the entitlement sync for `northstar-prod`. The workspace is on Pro with 12 seats now, and I've posted a note into the thread so whoever replies knows the account is already fixed.",
          },
          threadEffect: "Agent action — entitlement sync re-run by AI (approved by you) · northstar-prod is now on Pro",
        },
        {
          triggers: ["refund"],
          approval: {
            title: "Issue full refund",
            summary: "$1,188.00 back to the card on txn_9bc1f2 · reason: upgrade not applied",
          },
          turn: {
            toolCalls: [
              {
                toolName: "payments.refund",
                args: { transactionId: "txn_9bc1f2", amount: "$1,188.00", reason: "upgrade-not-applied" },
                result: { success: true, rowCount: 1, result: [{ refundId: "re_7Hd2k", status: "succeeded", amount: "$1,188.00" }] },
              },
            ],
            text: "Refund issued — $1,188.00 back to the card on `txn_9bc1f2` (refund `re_7Hd2k`). If you'd rather keep the charge and just apply the upgrade, ask me to re-run the sync instead; refunds and fixes are both one action from here.",
          },
          threadEffect: "Agent action — full refund of $1,188.00 issued by AI (approved by you) · re_7Hd2k",
        },
      ],
      fallback: "This demo answers from Maya's seeded context — try asking about the failed upgrade, or tell me to \"re-run the sync\" or \"issue a refund\" to see agent actions.",
    },
  },
  {
    id: "conv-passkey",
    channel: "whatsapp",
    customer: { name: "Elena Rivera", company: "Orbit Desk", hue: 152 },
    subject: "Passkey rollout for admins first?",
    preview: "Can we turn on passkeys for admins before customers?",
    minutesAgo: 12,
    unread: true,
    priority: "normal",
    aiState: "standing-by",
    confidence: 38,
    seedMessages: [
      { id: "pk1", sender: "customer", kind: "text", body: "Can we turn on passkeys for admins before rolling them out to customers? We want to trial internally first.", at: "10:30" },
      { id: "pk2", sender: "system", kind: "status", body: "AI classified this as a rollout-strategy question and is standing by for a human — confidence 38%", at: "10:30" },
    ],
    initialDraft: "Hi Elena — yes, that's a common pattern. You can scope passkeys to a team via a sign-up rule so only your admin team sees the option, trial it, then remove the rule to open it up. Happy to walk you through it on a call if useful.",
    dossier: {
      userId: "user_J4p2A",
      email: "elena@orbitdesk.io",
      plan: "Growth",
      signedUpAgo: "7 months ago",
      authEvents: ["Searched docs for \"passkeys\" · 10:24", "Opened Auth Methods page · 10:26", "Signed in via email OTP · 10:22"],
      replay: null,
      pastTickets: [
        { subject: "SSO domain verification", resolvedAgo: "2 months ago" },
        { subject: "Webhook signature mismatch", resolvedAgo: "5 months ago" },
      ],
    },
    timeline: [
      { id: "kt1", kind: "event", label: "docs.search \"passkeys\"", at: "10:24", tone: "neutral" },
      { id: "kt2", kind: "span", label: "GET /auth-methods", at: "10:26", detail: "96ms", tone: "ok" },
      { id: "kt3", kind: "event", label: "auth_methods.page.opened", at: "10:26", tone: "neutral" },
      { id: "kt4", kind: "message", label: "Asked on WhatsApp", at: "10:30", tone: "neutral" },
    ],
    copilot: {
      initial: {
        toolCalls: [
          {
            toolName: "read-docs",
            args: { query: "staged passkey rollout by team" },
            result: { success: true, rowCount: 2, result: [{ page: "Auth Methods / Passkeys", section: "Gradual rollout" }, { page: "Sign-up Rules", section: "Scoping by team" }] },
          },
        ],
        text: "This is a how-to question, not a bug — the AI held back so a human answers rollout strategy. The docs support her plan: passkeys can be scoped to a team via a sign-up rule, trialed by admins, then opened up. She's technical (set up SSO herself 2 months ago), so a concise pointer will land well. Draft is in the composer.",
      },
      responses: [],
      fallback: "This demo answers from Elena's seeded context — try asking why the AI didn't reply, or what to tell her about staged rollouts.",
    },
  },
  {
    id: "conv-magiclink",
    channel: "email",
    customer: { name: "Jon Bell", company: "Beacon Forms", hue: 24 },
    subject: "Magic link emails are slow",
    preview: "Users are waiting 5–10 minutes for magic links.",
    minutesAgo: 18,
    unread: true,
    priority: "high",
    aiState: "auto-replied",
    confidence: 93,
    clusterId: "email-latency",
    seedMessages: [],
    script: [
      { kind: "wait", ms: 500 },
      { kind: "message", message: { id: "ml1", sender: "customer", kind: "text", body: "Our users are waiting 5–10 minutes for magic link emails this morning. Nothing changed on our side.", at: "10:17" } },
      { kind: "wait", ms: 900 },
      { kind: "typing", sender: "ai" },
      { kind: "confidence", to: 46 },
      { kind: "wait", ms: 1400 },
      { kind: "confidence", to: 78 },
      { kind: "wait", ms: 1200 },
      { kind: "confidence", to: 93 },
      { kind: "wait", ms: 600 },
      { kind: "message", message: { id: "ml2", sender: "ai", kind: "auto-reply", body: "Hi Jon — this is a known delay with our email provider's US-East delivery starting around 10:05. Your integration is healthy; links are queued, not lost, and deliver within ~8 minutes. We're rerouting through a secondary provider now and expect normal latency within the hour. Status: hexclave.statuspage.io/incidents/4821", at: "10:18" } },
      { kind: "wait", ms: 800 },
      { kind: "incident-trip" },
      { kind: "message", message: { id: "ml3", sender: "system", kind: "status", body: "8 similar reports in the last 18 minutes — incident opened, replies to this cluster are held for one canonical answer", at: "10:19" } },
    ],
    dossier: {
      userId: "user_2SmV9",
      email: "jon@beaconforms.com",
      plan: "Enterprise",
      signedUpAgo: "2 years ago",
      authEvents: ["magic_link.requested ×41 · since 10:05", "email.delivered p95 7m 12s · last hour", "Provider delivery degraded · 10:05"],
      replay: { id: "rpl_8mm41", label: "Repeated resend clicks on sign-in screen", duration: "2m 10s" },
      pastTickets: [],
    },
    timeline: [
      { id: "mt1", kind: "event", label: "magic_link.requested ×41", at: "10:05+", detail: "normal volume", tone: "neutral" },
      { id: "mt2", kind: "span", label: "POST /auth/send-magic-link", at: "10:06", detail: "188ms", tone: "ok" },
      { id: "mt3", kind: "span", label: "email.outbox.enqueue", at: "10:06", detail: "44ms", tone: "ok" },
      { id: "mt4", kind: "span", label: "provider.delivery", at: "10:06", detail: "7m 12s p95", tone: "error" },
      { id: "mt5", kind: "event", label: "resend clicked ×6", at: "10:12", detail: "from session replay", tone: "warn" },
      { id: "mt6", kind: "message", label: "Wrote in via email", at: "10:17", tone: "neutral" },
    ],
    copilot: {
      initial: {
        toolCalls: [
          {
            toolName: "sql-query",
            args: { query: "SELECT percentile(delivery_seconds, 0.95) FROM email_deliveries WHERE sent_at > now() - interval '1 hour'" },
            result: { success: true, rowCount: 1, result: [{ p95_delivery: "7m 12s", baseline: "9s", affected_projects: 31 }] },
          },
          {
            toolName: "find-replay",
            args: { userId: "user_2SmV9", around: "magic_link.requested" },
            result: { success: true, rowCount: 1, result: [{ replayId: "rpl_8mm41", window: "10:10–10:12", signal: "6 resend clicks in 2 minutes" }] },
          },
        ],
        text: "Provider-side incident, not Jon's integration: p95 email delivery is 7m 12s against a 9s baseline, across 31 projects. That's why confidence cleared 90% and the AI auto-replied with the canonical incident answer.\n\n8 similar reports arrived within 18 minutes, so an incident is open and further replies in this cluster are held — one canonical answer instead of nine hand-written ones.",
      },
      responses: [
        {
          text: "Once the provider reroute lands, I'd release the held replies with a short all-clear and close the incident. Everyone in the cluster gets the same resolution message with their own delivery stats attached.",
        },
      ],
      actions: [
        {
          triggers: ["publish", "status page", "statuspage"],
          approval: {
            title: "Publish status-page incident",
            summary: "Incident 4821 · \"Delayed magic-link and OTP email delivery\" goes public with the drafted copy",
          },
          turn: {
            toolCalls: [
              {
                toolName: "statuspage.publish",
                args: { incidentId: "inc-4821", state: "investigating" },
                result: { success: true, rowCount: 1, result: [{ incident: "inc-4821", published: true, url: "hexclave.statuspage.io/incidents/4821" }] },
              },
            ],
            text: "Published — the incident is live on the status page with the drafted copy. The 8 held conversations now reference it automatically; I'll draft the all-clear once provider latency recovers.",
          },
          threadEffect: "Agent action — status page incident 4821 published by AI (approved by you)",
        },
      ],
      fallback: "This demo answers from the incident context — try asking about the other affected reports, or tell me to \"publish the status page\".",
    },
  },
  {
    id: "conv-saml",
    channel: "web",
    customer: { name: "Priya Shah", company: "KiteCloud", hue: 205 },
    subject: "SAML metadata step is unclear",
    preview: "Do we paste the entity id or the metadata URL?",
    minutesAgo: 25,
    unread: false,
    priority: "normal",
    aiState: "resolved",
    confidence: 62,
    seedMessages: [
      { id: "sm1", sender: "customer", kind: "text", body: "The SAML setup docs lost me at step 3 — do we paste the entity id or the metadata URL? The field just says \"identifier\".", at: "10:04" },
      { id: "sm2", sender: "ai", kind: "text", body: "Good catch — that field takes the metadata URL, and your IdP's entity id is read from it automatically. I've also flagged the docs page for clarification.", at: "10:05" },
      { id: "sm3", sender: "customer", kind: "text", body: "That worked, thank you! The docs really should say that.", at: "10:09" },
    ],
    initialDraft: "Glad that unblocked you, Priya! We're updating the docs today so the field name and the guide match — thanks for flagging it.",
    dossier: {
      userId: "user_7MzL1",
      email: "priya@kitecloud.io",
      plan: "Business",
      signedUpAgo: "4 months ago",
      authEvents: ["docs.search \"saml metadata\" · 09:58", "SAML config PATCH failed (400) ×2 · 10:01", "SAML config saved · 10:07"],
      replay: { id: "rpl_5xq77", label: "SAML setup page and docs tab side by side", duration: "9m 02s" },
      pastTickets: [],
    },
    timeline: [
      { id: "st1", kind: "event", label: "docs.search \"saml metadata\"", at: "09:58", tone: "neutral" },
      { id: "st2", kind: "span", label: "PATCH /oauth-providers/saml", at: "10:01", detail: "400 · invalid identifier", tone: "error" },
      { id: "st3", kind: "message", label: "Asked in web chat", at: "10:04", tone: "neutral" },
      { id: "st4", kind: "span", label: "PATCH /oauth-providers/saml", at: "10:07", detail: "200", tone: "ok" },
      { id: "st5", kind: "event", label: "saml.connection.verified", at: "10:08", tone: "ok" },
    ],
    copilot: {
      initial: {
        toolCalls: [
          {
            toolName: "sql-query",
            args: { query: "SELECT count(*) FROM support_conversations WHERE topic = 'saml-metadata-confusion' AND created_at > now() - interval '7 days'" },
            result: { success: true, rowCount: 1, result: [{ count: 3, distinct_companies: 3 }] },
          },
          {
            toolName: "read-docs",
            args: { query: "SAML setup step 3 identifier" },
            result: { success: true, rowCount: 1, result: [{ page: "SSO / SAML", section: "Step 3 — Identity provider details", issue: "field labeled 'identifier', guide says 'entity id', product expects metadata URL" }] },
          },
        ],
        text: "Resolved, but the root cause is the docs: three separate companies hit the same confusion this week. The guide says \"entity id\", the field says \"identifier\", and the product actually wants the metadata URL. I've drafted a docs edit below — one sentence and a field-name alignment would eliminate this ticket category.",
      },
      responses: [],
      fallback: "This demo answers from Priya's seeded context — try asking about the suggested docs update.",
    },
    docsSuggestion: {
      title: "SSO / SAML — Step 3, identity provider details",
      reason: "3 conversations this week hit the same confusion; the field label, guide text, and expected value disagree.",
      removed: ["3. Paste your identity provider's entity id into the identifier field."],
      added: ["3. Paste your identity provider's metadata URL into the identifier field.", "   Hexclave reads the entity id from the metadata automatically — you never need to enter it by hand."],
    },
  },
  {
    id: "conv-devin",
    channel: "slack",
    customer: { name: "Marcus Webb", company: "TailForge", hue: 340 },
    subject: "Sign-in button dead on Safari 26",
    preview: "Clicking sign-in does nothing on Safari 26. Console shows a TypeError.",
    minutesAgo: 34,
    unread: false,
    priority: "high",
    aiState: "intake",
    confidence: 55,
    seedMessages: [
      { id: "dv1", sender: "customer", kind: "text", body: "Clicking the sign-in button does nothing on Safari 26. Console shows `TypeError: navigator.credentials.get is not a function`. Works in Chrome.", at: "09:48" },
      { id: "dv2", sender: "ai", kind: "text", body: "Thanks for the exact error — that points at the passkey conditional-UI path. Which SDK version are you on, and is this the hosted sign-in page or your own?", at: "09:49" },
      { id: "dv3", sender: "customer", kind: "text", body: "@hexclave/next 2.8.1, our own page with the SignIn component.", at: "09:52" },
      { id: "dv4", sender: "system", kind: "status", body: "AI gathered repro details — needs a hands-on reproduction to confirm the fix. Tag @Devin to reproduce and record it.", at: "09:53" },
    ],
    initialDraft: "Hi Marcus — confirmed: 2.8.1 calls the passkey conditional UI without feature-detecting `navigator.credentials`, which Safari 26 dropped behind a flag. Upgrading to 2.8.3 fixes it; if you're pinned, wrapping SignIn with `passkeys={false}` is a safe stopgap.",
    devinSuggested: true,
    dossier: {
      userId: "user_5TrX8",
      email: "marcus@tailforge.dev",
      plan: "Growth",
      signedUpAgo: "11 months ago",
      authEvents: ["sign_in.attempt ×9, 0 completions (Safari) · 09:40–09:47", "SDK @hexclave/next 2.8.1 · from client hello", "sign_in.completed (Chrome) · 09:55"],
      replay: { id: "rpl_9wd12", label: "Sign-in clicks with no navigation, Safari 26", duration: "1m 38s" },
      pastTickets: [{ subject: "CORS on custom domain", resolvedAgo: "6 months ago" }],
    },
    timeline: [
      { id: "dt1", kind: "event", label: "sign_in.attempt ×9, 0 completions", at: "09:40+", detail: "Safari 26 only", tone: "error" },
      { id: "dt2", kind: "span", label: "GET /api/latest/auth/passkey/options", at: "09:41", detail: "never called — throws client-side", tone: "warn" },
      { id: "dt3", kind: "message", label: "Reported on Slack", at: "09:48", tone: "neutral" },
      { id: "dt4", kind: "event", label: "sign_in.completed (Chrome fallback)", at: "09:55", tone: "ok" },
    ],
    copilot: {
      initial: {
        toolCalls: [
          {
            toolName: "sql-query",
            args: { query: "SELECT browser, count(*) FROM sign_in_attempts WHERE project = 'tailforge' AND completed = false GROUP BY browser" },
            result: { success: true, rowCount: 2, result: [{ browser: "Safari 26", failed: 9 }, { browser: "Chrome 138", failed: 0 }] },
          },
          {
            toolName: "find-replay",
            args: { userId: "user_5TrX8", around: "sign_in.attempt" },
            result: { success: true, rowCount: 1, result: [{ replayId: "rpl_9wd12", window: "09:40–09:42", signal: "button clicks, no navigation, console TypeError" }] },
          },
        ],
        text: "Classic Safari 26 regression: SDK 2.8.1's passkey conditional UI calls `navigator.credentials.get` without feature detection, and Safari 26 moved it behind a flag. All 9 failed attempts are Safari; Chrome is clean.\n\nThe fix shipped in 2.8.3. To confirm and get a repro on record, tag @Devin in the composer — it will reproduce on Safari 26 and record a demo video for the ticket.",
      },
      responses: [
        {
          text: "Devin's repro confirms it: same TypeError on a clean Safari 26 with SDK 2.8.1, gone on 2.8.3. The video is attached to the thread — safe to send the drafted reply with the upgrade guidance.",
        },
      ],
      fallback: "This demo answers from Marcus's seeded context — try asking about the Safari failure or tag @Devin in the reply box.",
    },
  },
  {
    id: "conv-closed",
    channel: "imessage",
    customer: { name: "Aiko Tanaka", company: "Lumen Analytics", hue: 95 },
    subject: "OAuth redirect loops on staging",
    preview: "Resolved — trusted domain was missing the staging URL.",
    minutesAgo: 190,
    unread: false,
    priority: "normal",
    aiState: "resolved",
    confidence: 88,
    seedMessages: [
      { id: "cl1", sender: "customer", kind: "text", body: "Our staging env redirect-loops after Google sign-in. Production is fine.", at: "07:12" },
      { id: "cl2", sender: "ai", kind: "text", body: "Can you share the staging URL? Loops like this are usually a missing trusted domain.", at: "07:13" },
      { id: "cl3", sender: "customer", kind: "text", body: "staging.lumen-analytics.app", at: "07:15" },
      { id: "cl4", sender: "agent", kind: "text", body: "Confirmed — staging wasn't in your trusted domains, so the callback bounced. Added a note to the config page; adding `staging.lumen-analytics.app` fixes it.", at: "07:24" },
      { id: "cl5", sender: "customer", kind: "text", body: "That was it. Thanks for the quick turnaround!", at: "07:31" },
      { id: "cl6", sender: "system", kind: "status", body: "Resolved by Sam · trusted-domain misconfiguration · 19 minute handle time", at: "07:31" },
    ],
    dossier: {
      userId: "user_4KpB3",
      email: "aiko@lumen-analytics.app",
      plan: "Growth",
      signedUpAgo: "9 months ago",
      authEvents: ["oauth.callback.rejected ×12 (staging) · 07:02–07:14", "trusted_domain.added · 07:28", "sign_in.completed (staging) · 07:30"],
      replay: { id: "rpl_2hh80", label: "Redirect loop on staging sign-in", duration: "0m 51s" },
      pastTickets: [{ subject: "OAuth redirect loops on staging", resolvedAgo: "3 hours ago" }],
    },
    timeline: [
      { id: "ct1", kind: "event", label: "oauth.callback.rejected ×12", at: "07:02+", detail: "untrusted domain", tone: "error" },
      { id: "ct2", kind: "message", label: "Reported on iMessage", at: "07:12", tone: "neutral" },
      { id: "ct3", kind: "event", label: "trusted_domain.added", at: "07:28", tone: "ok" },
      { id: "ct4", kind: "event", label: "sign_in.completed on staging", at: "07:30", tone: "ok" },
    ],
    copilot: {
      initial: {
        text: "Closed ticket, kept for context: staging redirect-looped because the domain wasn't trusted. The AI narrowed it to a config issue in two messages; Sam confirmed and resolved in 19 minutes. If Aiko writes in again, this history and her config state load automatically.",
      },
      responses: [],
      fallback: "This conversation is resolved — its context stays available for future tickets from Aiko.",
    },
  },
];

export const DEMO_CLUSTERS: DemoCluster[] = [
  { id: "billing-upgrade", label: "Billing upgrade delays", conversationIds: ["conv-payments"] },
  { id: "email-latency", label: "Email delivery latency", conversationIds: ["conv-magiclink"] },
];

export const DEMO_INCIDENT: DemoIncident = {
  id: "inc-4821",
  title: "Delayed magic-link and OTP email delivery",
  reportCount: 9,
  windowMinutes: 18,
  clusterId: "email-latency",
  statusDraft: "Investigating — Transactional email delivery via our primary provider is delayed (p95 ~7 minutes) starting 10:05 UTC. Sign-in links are queued, not lost. We are rerouting through a secondary provider; no action is needed on your side.",
  heldConversationIds: ["conv-magiclink"],
};

export function getConversation(id: string): DemoConversation | undefined {
  return DEMO_CONVERSATIONS.find((conversation) => conversation.id === id);
}

export function getClusterSize(clusterId: string | undefined, incidentTripped: boolean): number {
  if (!clusterId) return 0;
  if (clusterId === DEMO_INCIDENT.clusterId) {
    return incidentTripped ? DEMO_INCIDENT.reportCount : 1;
  }
  const cluster = DEMO_CLUSTERS.find((candidate) => candidate.id === clusterId);
  return cluster?.conversationIds.length ?? 0;
}
