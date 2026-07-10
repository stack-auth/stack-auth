import type { CopilotTurn } from "./types";

export const FORENSIC_COPILOT_SCRIPT: CopilotTurn[] = [
  {
    id: "c1",
    role: "system",
    text: "Forensic clone attached. Logs, 8 session replays, and Atlas tenant config are in scope.",
    delayMs: 400,
  },
  {
    id: "c2",
    role: "agent",
    text: "Reproducing the invitations failure against the sanitized clone…",
    delayMs: 800,
  },
  {
    id: "c3",
    role: "agent",
    text: "Root cause: custom role lookup assumes role_id is always set for enterprise orgs with >5,000 members. Legacy path still null during SSO invite.",
    delayMs: 1_200,
  },
  {
    id: "c4",
    role: "agent",
    text: "Devin wants temporary read access to organization_roles in the sanitized clone — expires in 30 minutes.",
    delayMs: 600,
    approval: {
      id: "approve-org-roles-read",
      title: "Temporary read access",
      detail: "organization_roles in the sanitized forensic clone · expires in 30 minutes",
      expiresInMinutes: 30,
    },
  },
  {
    id: "c5",
    role: "agent",
    text: "Access granted. Applying null-safe role resolution + dual-read fallback…",
    delayMs: 1_000,
  },
  {
    id: "c6",
    role: "agent",
    text: "Repro: Failed → Passed. Compat check green. Regression suite green.",
    delayMs: 900,
  },
  {
    id: "c7",
    role: "system",
    text: "Fix packaged for affected tenants first, then global resume.",
    delayMs: 500,
  },
];

export const DATABASES_COPILOT_HINTS = [
  "Want me to make a safe 5 GB copy for the pricing PR?",
  "I can explain what the waiting cleanup step will do once Atlas moves forward.",
  "Before you apply that NOT NULL, I can show who it would break.",
] as const;
