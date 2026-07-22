// Everything in this app is intentionally frontend-only mock state. There is no
// backend resource for "deployments" yet — this is a UI exploration, so the
// board, services, and their environment variables live entirely in React state
// seeded from the fixtures below.

import { HexagonIcon, TriangleIcon } from "@phosphor-icons/react";

export type ServiceType = "hexclave" | "vercel";

export type ServiceStatus = "deployed" | "building" | "crashed" | "sleeping";

export type EnvVar = {
  id: string,
  key: string,
  value: string,
};

export type Domain = {
  id: string,
  hostname: string,
  primary: boolean,
  verified: boolean,
};

export type BuildConfig = {
  framework: string,
  installCommand: string,
  buildCommand: string,
  outputDirectory: string,
  rootDirectory: string,
};

export type Service = {
  id: string,
  name: string,
  type: ServiceType,
  // Position on the board, in board-pixel space (top-left corner of the node).
  x: number,
  y: number,
  status: ServiceStatus,
  region: string,
  // Human-facing "what is this" line: the git repo for Vercel services and a
  // fixed descriptor for the Hexclave service.
  source: string,
  domain?: string,
  envVars: EnvVar[],
  domains: Domain[],
  buildConfig: BuildConfig,
};

// Fixed node footprint. Kept constant across every visual variant so the
// connection-line geometry can be computed deterministically from positions
// alone (see connections.ts) rather than measuring DOM on every drag frame.
export const NODE_WIDTH = 256;
export const NODE_HEIGHT = 108;

export type ServiceOutput = {
  key: string,
  label: string,
  // A fake resolved value, shown as a preview so the reference feels real.
  sample: string,
  secret?: boolean,
};

// The outputs each service *type* exposes for other services to reference.
// A reference looks like `{serviceName.outputKey}` in an env var value.
const OUTPUTS_BY_TYPE = new Map<ServiceType, ServiceOutput[]>([
  ["hexclave", [
    { key: "projectId", label: "Project ID", sample: "6fbbf22e-1a2b-4c3d-9e8f-112233445566" },
    { key: "apiUrl", label: "API URL", sample: "https://api.hexclave.com" },
    { key: "jwksUrl", label: "JWKS URL", sample: "https://api.hexclave.com/.well-known/jwks.json" },
    { key: "publishableClientKey", label: "Publishable client key", sample: "pck_9f2c…a71" },
    { key: "secretServerKey", label: "Secret server key", sample: "ssk_4d18…e0c", secret: true },
  ]],
  ["vercel", [
    { key: "url", label: "Production URL", sample: "https://my-app.vercel.app" },
    { key: "previewUrl", label: "Preview URL", sample: "https://my-app-git-main.vercel.app" },
  ]],
]);

export function getServiceOutputs(type: ServiceType): ServiceOutput[] {
  return OUTPUTS_BY_TYPE.get(type) ?? [];
}

export type ServiceTypeMeta = {
  label: string,
  icon: React.ElementType,
  // Semantic accent used by badges, node accent bars, and connection lines.
  accent: "purple" | "cyan" | "green",
  hint: string,
};

export const SERVICE_TYPE_META = new Map<ServiceType, ServiceTypeMeta>([
  ["hexclave", {
    label: "Hexclave",
    icon: HexagonIcon,
    accent: "purple",
    hint: "Your Hexclave backend. Exactly one per project.",
  }],
  ["vercel", {
    label: "Vercel",
    icon: TriangleIcon,
    accent: "cyan",
    hint: "A service deployed on Vercel from a git repo.",
  }],
]);

export function getServiceTypeMeta(type: ServiceType): ServiceTypeMeta {
  const meta = SERVICE_TYPE_META.get(type);
  if (!meta) throw new Error(`Unknown service type: ${type}`);
  return meta;
}

// Types a user is allowed to add. "hexclave" is intentionally excluded: every
// board must have exactly one Hexclave service and it can't be created or
// deleted.
export const ADDABLE_SERVICE_TYPES: Exclude<ServiceType, "hexclave">[] = ["vercel"];

export function defaultBuildConfig(type: ServiceType): BuildConfig {
  if (type === "hexclave") {
    return { framework: "Managed", installCommand: "", buildCommand: "", outputDirectory: "", rootDirectory: "" };
  }
  return {
    framework: "Next.js",
    installCommand: "pnpm install",
    buildCommand: "pnpm build",
    outputDirectory: ".next",
    rootDirectory: "./",
  };
}

export function getInitialServices(): Service[] {
  return [
    {
      id: "svc_hexclave",
      name: "hexclave",
      type: "hexclave",
      x: 96,
      y: 200,
      status: "deployed",
      region: "us-east",
      source: "Hexclave managed backend",
      domain: "api.hexclave.com",
      envVars: [],
      domains: [{ id: "d_hx", hostname: "api.hexclave.com", primary: true, verified: true }],
      buildConfig: defaultBuildConfig("hexclave"),
    },
    {
      id: "svc_backend",
      name: "backend",
      type: "vercel",
      x: 520,
      y: 96,
      status: "deployed",
      region: "us-east",
      source: "github.com/acme/backend",
      domain: "backend-acme.vercel.app",
      envVars: [
        { id: "e1", key: "HEXCLAVE_PROJECT_ID", value: "{hexclave.projectId}" },
        { id: "e2", key: "HEXCLAVE_SECRET_SERVER_KEY", value: "{hexclave.secretServerKey}" },
        { id: "e3", key: "PORT", value: "8080" },
      ],
      domains: [
        { id: "d_be1", hostname: "backend-acme.vercel.app", primary: true, verified: true },
        { id: "d_be2", hostname: "api.acme.com", primary: false, verified: true },
      ],
      buildConfig: { framework: "Next.js", installCommand: "pnpm install", buildCommand: "pnpm build", outputDirectory: ".next", rootDirectory: "apps/backend" },
    },
    {
      id: "svc_web",
      name: "web",
      type: "vercel",
      x: 520,
      y: 360,
      status: "deployed",
      region: "global",
      source: "github.com/acme/web",
      domain: "web-acme.vercel.app",
      envVars: [
        { id: "e4", key: "NEXT_PUBLIC_HEXCLAVE_PROJECT_ID", value: "{hexclave.projectId}" },
        { id: "e5", key: "NEXT_PUBLIC_HEXCLAVE_PUBLISHABLE_CLIENT_KEY", value: "{hexclave.publishableClientKey}" },
        { id: "e6", key: "API_BASE_URL", value: "{backend.url}" },
      ],
      domains: [
        { id: "d_web1", hostname: "web-acme.vercel.app", primary: false, verified: true },
        { id: "d_web2", hostname: "acme.com", primary: true, verified: true },
        { id: "d_web3", hostname: "www.acme.com", primary: false, verified: false },
      ],
      buildConfig: { framework: "Next.js", installCommand: "pnpm install", buildCommand: "pnpm build", outputDirectory: ".next", rootDirectory: "apps/web" },
    },
  ];
}

// ---------------------------------------------------------------------------
// Read-only mock for the Deployments / Logs tabs. Deterministic (no Date.now /
// Math.random, which are unavailable here and would break re-render stability).
// ---------------------------------------------------------------------------

export type DeploymentStatus = "queued" | "building" | "success" | "failed" | "cancelled";

export type Deployment = {
  id: string,
  status: DeploymentStatus,
  environment: "Production" | "Preview",
  createdAtLabel: string,
  durationLabel: string,
  branch: string,
  commitSha: string,
  commitMessage: string,
  author: string,
};

export type LogLevel = "info" | "warn" | "error";

export type LogLine = {
  id: string,
  timestamp: string,
  level: LogLevel,
  message: string,
};

const DEPLOYMENT_TEMPLATE: Omit<Deployment, "id">[] = [
  { status: "success", environment: "Production", createdAtLabel: "2m ago", durationLabel: "47s", branch: "main", commitSha: "a1b2c3d", commitMessage: "Fix sign-out redirect loop", author: "alex" },
  { status: "building", environment: "Preview", createdAtLabel: "just now", durationLabel: "—", branch: "feat/new-nav", commitSha: "e4f5a6b", commitMessage: "Add collapsible sidebar nav", author: "sam" },
  { status: "failed", environment: "Preview", createdAtLabel: "18m ago", durationLabel: "1m 12s", branch: "feat/checkout", commitSha: "c7d8e9f", commitMessage: "Wire up checkout summary", author: "sam" },
  { status: "cancelled", environment: "Preview", createdAtLabel: "1h ago", durationLabel: "9s", branch: "chore/bump-deps", commitSha: "0a1b2c3", commitMessage: "Bump dependencies", author: "alex" },
  { status: "success", environment: "Production", createdAtLabel: "3h ago", durationLabel: "52s", branch: "main", commitSha: "4d5e6f7", commitMessage: "Improve empty states", author: "jordan" },
  { status: "success", environment: "Production", createdAtLabel: "yesterday", durationLabel: "44s", branch: "main", commitSha: "8a9b0c1", commitMessage: "Initial production launch", author: "jordan" },
];

export function getServiceDeployments(service: Service): Deployment[] {
  return DEPLOYMENT_TEMPLATE.map((d, i) => ({ ...d, id: `${service.id}_dep_${i}` }));
}

export function getDeploymentLogs(deployment: Deployment): LogLine[] {
  const base: Omit<LogLine, "id">[] = [
    { timestamp: "12:04:31.002", level: "info", message: `Cloning github.com/acme/${deployment.branch} (${deployment.commitSha})` },
    { timestamp: "12:04:32.118", level: "info", message: "Restoring build cache…" },
    { timestamp: "12:04:33.640", level: "info", message: "Running \"pnpm install\"" },
    { timestamp: "12:04:41.902", level: "info", message: "Packages: +812 done in 8.2s" },
    { timestamp: "12:04:42.130", level: "info", message: "Running \"pnpm build\"" },
    { timestamp: "12:04:49.771", level: "info", message: "Creating an optimized production build…" },
    { timestamp: "12:05:02.455", level: "info", message: "Compiled successfully" },
    { timestamp: "12:05:03.010", level: "info", message: "Collecting page data…" },
    { timestamp: "12:05:07.884", level: "info", message: "Generating static pages (24/24)" },
  ];
  const success: Omit<LogLine, "id">[] = [
    { timestamp: "12:05:12.301", level: "info", message: "Uploading build outputs…" },
    { timestamp: "12:05:16.740", level: "info", message: "Deployment ready — assigned production domain" },
  ];
  const failed: Omit<LogLine, "id">[] = [
    { timestamp: "12:05:09.120", level: "error", message: "Type error: Property 'total' does not exist on type 'Cart'." },
    { timestamp: "12:05:09.121", level: "error", message: "  at app/checkout/summary.tsx:42:19" },
    { timestamp: "12:05:09.400", level: "error", message: "Command \"pnpm build\" exited with 1" },
  ];
  const cancelled: Omit<LogLine, "id">[] = [
    { timestamp: "12:04:42.900", level: "warn", message: "Deployment cancelled by user" },
  ];
  const building: Omit<LogLine, "id">[] = [
    { timestamp: "12:05:08.001", level: "info", message: "Building…" },
  ];

  let tail: Omit<LogLine, "id">[];
  switch (deployment.status) {
    case "success": {
      tail = success;
      break;
    }
    case "failed": {
      tail = failed;
      break;
    }
    case "cancelled": {
      tail = [...cancelled];
      break;
    }
    case "queued": {
      tail = [{ timestamp: "12:04:30.000", level: "info", message: "Queued — waiting for an available builder…" }];
      break;
    }
    case "building":
    default: {
      tail = building;
      break;
    }
  }

  // Failed/cancelled runs stop partway; success/building show the full lead-in.
  const lead = deployment.status === "cancelled" ? base.slice(0, 5)
    : deployment.status === "failed" ? base.slice(0, 7)
      : deployment.status === "queued" ? [] : base;

  return [...lead, ...tail].map((l, i) => ({ ...l, id: `${deployment.id}_log_${i}` }));
}

export function getServiceLogs(service: Service): LogLine[] {
  const lines: Omit<LogLine, "id">[] = [
    { timestamp: "12:06:01.114", level: "info", message: `[${service.name}] listening on :8080` },
    { timestamp: "12:06:04.552", level: "info", message: "GET /api/health 200 in 3ms" },
    { timestamp: "12:06:09.870", level: "info", message: "GET / 200 in 41ms" },
    { timestamp: "12:06:12.201", level: "info", message: "POST /api/auth/session 201 in 88ms" },
    { timestamp: "12:06:18.913", level: "warn", message: "Slow query (312ms): SELECT * FROM users WHERE …" },
    { timestamp: "12:06:22.400", level: "info", message: "GET /dashboard 200 in 24ms" },
    { timestamp: "12:06:29.771", level: "error", message: "Unhandled rejection: upstream timeout after 5000ms" },
    { timestamp: "12:06:29.772", level: "error", message: "  at fetchBilling (lib/billing.ts:88)" },
    { timestamp: "12:06:31.010", level: "info", message: "GET /api/health 200 in 2ms" },
    { timestamp: "12:06:37.640", level: "info", message: "POST /api/webhooks/stripe 200 in 130ms" },
    { timestamp: "12:06:44.318", level: "warn", message: "Rate limit near threshold for ip 10.0.0.4 (92/100)" },
    { timestamp: "12:06:51.905", level: "info", message: "GET /api/health 200 in 3ms" },
  ];
  return lines.map((l, i) => ({ ...l, id: `${service.id}_rlog_${i}` }));
}
