// View-model for the Deployments board, backed by the real deployments API
// (project.listDeploymentServices() and friends). The board shows the managed
// Hexclave service (synthetic — it always exists and can't be edited) plus one
// node per deployment service from the project config.

import { HexagonIcon, TriangleIcon } from "@phosphor-icons/react";
import type { AdminDeploymentServiceJson } from "@hexclave/next";

export type ServiceType = "hexclave" | "vercel";

// Node states shown on the board; a superset of the API's service status so
// the managed Hexclave node and never-deployed services render meaningfully.
export type ServiceStatus = "deployed" | "building" | "not_deployed" | "crashed" | "canceled";

export type EnvVar = {
  id: string,
  key: string,
  value: string,
  isSecret: boolean,
};

export type BoardService = {
  // The service id — the key under `deployments.services` in the config, or
  // "hexclave" for the managed service.
  id: string,
  name: string,
  type: ServiceType,
  // Position on the board, in board-pixel space (top-left corner of the node).
  x: number,
  y: number,
  status: ServiceStatus,
  // Human-facing "what is this" line under the service name.
  source: string,
  domain?: string,
  envVars: EnvVar[],
  // The raw API object for vercel services; null for the managed Hexclave one.
  api: AdminDeploymentServiceJson | null,
};

// Fixed node footprint. Kept constant so the connection-line geometry can be
// computed deterministically from positions alone (see connections.ts) rather
// than measuring DOM on every drag frame.
export const NODE_WIDTH = 256;
export const NODE_HEIGHT = 108;

export type ServiceOutput = {
  key: string,
  label: string,
  secret?: boolean,
};

// The outputs each service *type* exposes for other services to reference in
// env var values (as `{serviceId.outputKey}`). Must stay in sync with the
// server-side resolver (apps/backend/src/lib/deployments — resolveEnvVars).
const OUTPUTS_BY_TYPE = new Map<ServiceType, ServiceOutput[]>([
  ["hexclave", [
    { key: "projectId", label: "Project ID" },
    { key: "apiUrl", label: "API URL" },
    { key: "jwksUrl", label: "JWKS URL" },
    { key: "publishableClientKey", label: "Publishable client key" },
    { key: "secretServerKey", label: "Secret server key", secret: true },
  ]],
  ["vercel", [
    { key: "url", label: "Production URL" },
    { key: "previewUrl", label: "Preview URL" },
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
    hint: "A service built and hosted on Vercel, deployed with `hexclave deploy`.",
  }],
]);

export function getServiceTypeMeta(type: ServiceType): ServiceTypeMeta {
  const meta = SERVICE_TYPE_META.get(type);
  if (!meta) throw new Error(`Unknown service type: ${type}`);
  return meta;
}

export function apiStatusToBoardStatus(status: AdminDeploymentServiceJson["status"]): ServiceStatus {
  switch (status) {
    case "not_deployed": {
      return "not_deployed";
    }
    case "queued":
    case "building": {
      return "building";
    }
    case "deployed": {
      return "deployed";
    }
    case "failed": {
      return "crashed";
    }
    case "canceled": {
      return "canceled";
    }
  }
}

function hostnameOfUrl(url: string | null): string | undefined {
  if (url == null) return undefined;
  try {
    return new URL(url).host;
  } catch {
    return undefined;
  }
}

/**
 * Builds the board view-model from the API service list. Positions are a
 * deterministic layout (managed service on the left, deployment services in
 * columns to the right); the board applies the user's in-session drag offsets
 * on top.
 */
export function buildBoardServices(apiServices: AdminDeploymentServiceJson[], hexclaveApiHost: string): BoardService[] {
  const services: BoardService[] = [{
    id: "hexclave",
    name: "hexclave",
    type: "hexclave",
    x: 96,
    y: 200,
    status: "deployed",
    source: "Hexclave managed backend",
    domain: hexclaveApiHost,
    envVars: [],
    api: null,
  }];
  // The config schema rejects a "hexclave" service id, but stay defensive:
  // a shadowing entry would collide with the synthetic managed node's key.
  apiServices.filter((apiService) => apiService.id !== "hexclave").forEach((apiService, index) => {
    services.push({
      id: apiService.id,
      name: apiService.id,
      type: "vercel",
      x: 520 + Math.floor(index / 4) * 320,
      y: 96 + (index % 4) * 150,
      status: apiStatusToBoardStatus(apiService.status),
      source: apiService.framework != null && apiService.framework !== "" ? apiService.framework : "Deployed with `hexclave deploy`",
      domain: apiService.domains.find((d) => d.is_primary)?.hostname ?? hostnameOfUrl(apiService.url),
      envVars: apiService.env_vars.map((envVar) => ({
        id: envVar.id,
        key: envVar.key,
        value: envVar.value,
        isSecret: envVar.is_secret,
      })),
      api: apiService,
    });
  });
  return services;
}
