type AppTag = {
  displayName: string,
};

export const ALL_APP_TAGS = {
  "expert": {
    displayName: "Expert",
  },
  "integration": {
    displayName: "Integrations",
  },
  "auth": {
    displayName: "Authentication",
  },
  "developers": {
    displayName: "For Developers",
  },
  "security": {
    displayName: "Security",
  },
  "operations": {
    displayName: "For Operations",
  },
  "gtm": {
    displayName: "Go-to-market",
  },
  "comms": {
    displayName: "Communications",
  },
  "automation": {
    displayName: "Automation",
  },
  "storage": {
    displayName: "Storage & Databases",
  },
  "various": {
    displayName: "Various",
  },
} as const satisfies Record<string, AppTag>;

type App = {
  displayName: string,
  subtitle: string,
  tags: (keyof typeof ALL_APP_TAGS)[],
  stage: "alpha" | "beta" | "stable",
};

export type AppId = keyof typeof ALL_APPS;

export const ALL_APPS = {
  "authentication": {
    displayName: "Authentication",
    subtitle: "User sign-in and account management",
    tags: ["auth", "security"],
    stage: "stable",
  },
  "teams": {
    displayName: "Teams",
    subtitle: "Team collaboration and management",
    tags: ["auth", "security"],
    stage: "stable",
  },
  "rbac": {
    displayName: "RBAC",
    subtitle: "Role-based access control and permissions",
    tags: ["auth", "security"],
    stage: "stable",
  },
  "api-keys": {
    displayName: "API Keys",
    subtitle: "API key generation and management",
    tags: ["auth", "security", "developers"],
    stage: "stable",
  },
  "payments": {
    displayName: "Payments",
    subtitle: "Payment processing and subscription management",
    tags: ["operations", "gtm"],
    stage: "beta",
  },
  "emails": {
    displayName: "Emails",
    subtitle: "Email template configuration and management",
    tags: ["comms"],
    stage: "stable",
  },
  "email-api": {
    displayName: "Email API",
    subtitle: "Programmatic email sending and delivery",
    tags: ["comms", "developers", "expert"],
    stage: "alpha",
  },
  "data-vault": {
    displayName: "Data Vault",
    subtitle: "Secure storage for sensitive user data",
    tags: ["security", "storage"],
    stage: "beta",
  },
  "webhooks": {
    displayName: "Webhooks",
    subtitle: "Real-time event notifications and integrations",
    tags: ["developers"],
    stage: "stable",
  },
  "tv-mode": {
    displayName: "TV mode",
    subtitle: "Dashboard display for large screens",
    tags: ["various"],
    stage: "alpha",
  },
  "launch-checklist": {
    displayName: "Launch Checklist",
    subtitle: "Pre-launch verification and readiness checks",
    tags: ["various"],
    stage: "stable",
  },
  "catalyst": {
    displayName: "Catalyst",
    subtitle: "Project scaffolding and rapid development",
    tags: ["various"],
    stage: "alpha",
  },
  "neon": {
    displayName: "Neon Integration",
    subtitle: "Serverless Postgres database integration",
    tags: ["integration", "storage"],
    stage: "alpha",
  },
  "convex": {
    displayName: "Convex Integration",
    subtitle: "Real-time backend platform integration",
    tags: ["integration", "storage"],
    stage: "alpha",
  },
  "vercel": {
    displayName: "Vercel Integration",
    subtitle: "Deploy your Stack Auth project to Vercel",
    tags: ["integration", "developers"],
    stage: "stable",
  },
} as const satisfies Record<string, App>;
