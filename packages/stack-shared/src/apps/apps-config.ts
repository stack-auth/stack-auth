type AppTag = {
  displayName: string,
};

export const ALL_APP_TAGS = {
  "auth": {
    displayName: "Authentication",
  },
  "developers": {
    displayName: "For Developers",
  },
  "security": {
    displayName: "Security",
  },
  "integrations": {
    displayName: "Integrations",
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
  type: "app" | "integration",
  displayName: string,
  subtitle: string,
  tags: (keyof typeof ALL_APP_TAGS)[],
  stage: "alpha" | "beta" | "stable",
};

export type AppId = keyof typeof ALL_APPS;

export const ALL_APPS = {
  "authentication": {
    type: "app",
    displayName: "Authentication",
    subtitle: "User sign-in and account management",
    tags: ["auth", "security"],
    stage: "stable",
  },
  "teams": {
    type: "app",
    displayName: "Teams",
    subtitle: "Team collaboration and management",
    tags: ["auth", "security"],
    stage: "stable",
  },
  "rbac": {
    type: "app",
    displayName: "RBAC",
    subtitle: "Role-based access control and permissions",
    tags: ["auth", "security"],
    stage: "stable",
  },
  "api-keys": {
    type: "app",
    displayName: "API Keys",
    subtitle: "API key generation and management",
    tags: ["auth", "security", "developers"],
    stage: "stable",
  },
  "payments": {
    type: "app",
    displayName: "Payments",
    subtitle: "Payment processing and subscription management",
    tags: ["operations", "gtm"],
    stage: "stable",
  },
  "emails": {
    type: "app",
    displayName: "Emails",
    subtitle: "Email template configuration and management",
    tags: ["comms"],
    stage: "stable",
  },
  "email-api": {
    type: "app",
    displayName: "Email API",
    subtitle: "Programmatic email sending and delivery",
    tags: ["comms", "developers"],
    stage: "alpha",
  },
  "data-vault": {
    type: "app",
    displayName: "Data Vault",
    subtitle: "Secure storage for sensitive user data",
    tags: ["security", "storage"],
    stage: "stable",
  },
  "workflows": {
    type: "app",
    displayName: "Workflows",
    subtitle: "Automated business process orchestration",
    tags: ["automation"],
    stage: "beta",
  },
  "webhooks": {
    type: "app",
    displayName: "Webhooks",
    subtitle: "Real-time event notifications and integrations",
    tags: ["integrations"],
    stage: "stable",
  },
  "tv-mode": {
    type: "app",
    displayName: "TV mode",
    subtitle: "Dashboard display for large screens",
    tags: ["various"],
    stage: "alpha",
  },
  "launch-checklist": {
    type: "app",
    displayName: "Launch Checklist",
    subtitle: "Pre-launch verification and readiness checks",
    tags: ["various"],
    stage: "alpha",
  },
  "catalyst": {
    type: "app",
    displayName: "Catalyst",
    subtitle: "Project scaffolding and rapid development",
    tags: ["various"],
    stage: "alpha",
  },
  "neon": {
    type: "integration",
    displayName: "Neon",
    subtitle: "Serverless Postgres database integration",
    tags: ["integrations", "storage"],
    stage: "alpha",
  },
  "convex": {
    type: "integration",
    displayName: "Convex",
    subtitle: "Real-time backend platform integration",
    tags: ["integrations", "storage"],
    stage: "alpha",
  },
} as const satisfies Record<string, App>;
