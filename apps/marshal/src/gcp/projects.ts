import { createHash, randomBytes } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { GcpApiError, GcpClient, type GcpOperation } from "./client.js";

const TENANT_APIS = [
  "artifactregistry.googleapis.com",
  "compute.googleapis.com",
  "iam.googleapis.com",
  "logging.googleapis.com",
  "run.googleapis.com",
];

export type TenantProjectConfig = {
  envId: string,
  billingAccount: string,
  parent: string | null,
  projectPrefix: string,
  additionalApis?: string[],
};

export type TenantProject = {
  projectId: string,
  projectNumber: string,
};

type ProjectResource = {
  name: string,
  projectId: string,
  state: string,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseOperation(value: unknown, operationKind: string): GcpOperation {
  if (!isRecord(value) || typeof value.name !== "string") throw new Error(`Google Cloud returned an invalid ${operationKind} operation`);
  return { name: value.name, ...(typeof value.done === "boolean" ? { done: value.done } : {}) };
}

function parseProject(value: unknown): ProjectResource {
  if (!isRecord(value) || typeof value.name !== "string" || typeof value.projectId !== "string" || typeof value.state !== "string") {
    throw new Error("Google Cloud returned an invalid project resource");
  }
  return { name: value.name, projectId: value.projectId, state: value.state };
}

function projectNumberFromName(name: string): string {
  const match = /^projects\/([0-9]+)$/.exec(name);
  if (match === null) throw new Error(`Google Cloud returned invalid project resource name ${JSON.stringify(name)}`);
  return match[1];
}

function sanitizeProjectFragment(value: string, maxLength: number): string {
  const sanitized = value.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  return (sanitized === "" ? "x" : sanitized).slice(0, maxLength).replace(/-$/, "x");
}

export function projectIdForNamespace(config: Pick<TenantProjectConfig, "envId" | "projectPrefix">, ns: string): string {
  return `${projectIdPrefix(config)}-${createHash("sha256").update(`${config.envId}\0${ns}`).digest("hex").slice(0, 16)}`.slice(0, 30).replace(/-$/, "0");
}

// The prefix every Marshal-managed project id starts with, and the only one
// deleteDisposableProject will tear down.
export function projectIdPrefix(config: Pick<TenantProjectConfig, "envId" | "projectPrefix">): string {
  const configuredPrefix = sanitizeProjectFragment(config.projectPrefix, 8);
  const prefix = /^[a-z]/.test(configuredPrefix) ? configuredPrefix : `h${configuredPrefix}`.slice(0, 8);
  return prefix;
}

function projectEnvFragment(config: Pick<TenantProjectConfig, "envId">): string {
  return sanitizeProjectFragment(config.envId, 4);
}

// A fresh id for a pooled (pre-provisioned) project: unlike projectIdForNamespace it is
// NOT derived from the namespace, because the whole point of the pool is that projects
// exist before any tenant is known. Uniqueness comes from randomness; the assignment
// mapping in the store provides the per-namespace determinism instead.
export function pooledProjectId(config: Pick<TenantProjectConfig, "envId" | "projectPrefix">): string {
  const id = `${projectIdPrefix(config)}-${projectEnvFragment(config)}-${randomBytes(6).toString("hex")}`.slice(0, 30);
  return id.replace(/-$/, "0");
}

function normalizeBillingAccount(value: string): string {
  return value.startsWith("billingAccounts/") ? value : `billingAccounts/${value}`;
}

const inFlightProjects = new Map<string, Promise<TenantProject>>();

export class TenantProjectManager {
  constructor(
    private readonly client: GcpClient,
    private readonly config: TenantProjectConfig,
  ) {}

  async ensureForNamespace(ns: string): Promise<TenantProject> {
    const projectId = projectIdForNamespace(this.config, ns);
    const existing = inFlightProjects.get(projectId);
    if (existing !== undefined) return await existing;
    const provisioning = this.provisionProject(projectId, `Hexclave tenant ${sanitizeProjectFragment(ns, 14)}`);
    inFlightProjects.set(projectId, provisioning);
    try {
      return await provisioning;
    } finally {
      inFlightProjects.delete(projectId);
    }
  }

  // A pooled project: provisioned up front with a generic display name, before any
  // tenant exists to name it after. Same full provisioning sequence as ensureForNamespace.
  async provisionPooledProject(projectId: string): Promise<TenantProject> {
    return await this.provisionProject(projectId, "Hexclave tenant pool");
  }

  // The project side of describing an already-provisioned project: no provisioning, only
  // existence, state, and the project number everything downstream keys off.
  async describeActiveProject(projectId: string): Promise<TenantProject> {
    const project = await this.findProject(projectId);
    if (project === null) throw new Error(`tenant GCP project ${JSON.stringify(projectId)} does not exist or is not visible`);
    if (project.state !== "ACTIVE") throw new Error(`tenant GCP project ${JSON.stringify(projectId)} is not active`);
    return { projectId, projectNumber: projectNumberFromName(project.name) };
  }

  async describeExistingProject(projectId: string): Promise<TenantProject> {
    const project = await this.findProject(projectId);
    if (project === null) throw new Error(`configured existing GCP test project ${JSON.stringify(projectId)} does not exist or is not visible`);
    if (project.state !== "ACTIVE") throw new Error(`configured existing GCP test project ${JSON.stringify(projectId)} is not active`);
    return { projectId, projectNumber: projectNumberFromName(project.name) };
  }

  private async findProject(projectId: string): Promise<ProjectResource | null> {
    // Resource Manager deliberately permission-hides unknown project IDs behind a 403
    // for projects.get. Search returns an empty result instead, so a provisioner with
    // parent-level projectCreator can distinguish "not created yet" without requiring
    // global visibility into unrelated projects.
    const result = await this.client.request(`https://cloudresourcemanager.googleapis.com/v3/projects:search?query=${encodeURIComponent(`id:${projectId}`)}`);
    if (!isRecord(result) || (result.projects !== undefined && !Array.isArray(result.projects))) {
      throw new Error("Google Cloud returned an invalid project search result");
    }
    if (!Array.isArray(result.projects)) return null;
    const matches = result.projects.map(parseProject).filter((project) => project.projectId === projectId);
    if (matches.length > 1) throw new Error(`Google Cloud returned multiple projects for exact project ID ${JSON.stringify(projectId)}`);
    return matches[0] ?? null;
  }

  private async getProject(projectId: string): Promise<ProjectResource | null> {
    const result = await this.client.request(`https://cloudresourcemanager.googleapis.com/v3/projects/${encodeURIComponent(projectId)}`, { allow404: true });
    return result === null ? null : parseProject(result);
  }

  // Idempotent and full: whatever a tenant project needs to host runtimes — existence,
  // billing, APIs, service identity, runtime IAM — is ensured here. Safe to re-run on an
  // already-provisioned project, which is how a pooled project is claimed with zero GCP
  // work and how the lazy fallback provisions one from scratch.
  private async provisionProject(projectId: string, displayName: string): Promise<TenantProject> {
    let project = await this.findProject(projectId);
    if (project === null) {
      const body = {
        projectId,
        displayName,
        labels: {
          "hexclave-environment": sanitizeProjectFragment(this.config.envId, 63),
          "hexclave-managed": "true",
        },
        ...(this.config.parent === null ? {} : { parent: this.config.parent }),
      };
      const created = await this.client.request("https://cloudresourcemanager.googleapis.com/v3/projects", { method: "POST", body });
      await this.client.waitForOperation(parseOperation(created, "project-create"));
      project = await this.waitForActiveProject(projectId);
    } else if (project.state !== "ACTIVE") {
      project = await this.waitForActiveProject(projectId);
    }

    await this.attachBilling(projectId);
    await this.enableApis(projectId);
    const projectNumber = projectNumberFromName(project.name);
    await this.ensureServiceIdentity(projectNumber, "run.googleapis.com");
    await this.ensureRuntimeIam(projectId, projectNumber);
    return { projectId, projectNumber };
  }

  private async waitForActiveProject(projectId: string): Promise<ProjectResource> {
    const startedAt = performance.now();
    for (;;) {
      const project = await this.getProject(projectId);
      if (project !== null && project.state === "ACTIVE") return project;
      if (performance.now() - startedAt > 2 * 60 * 1000) throw new GcpApiError(408, `projects/${projectId}`, "timed out waiting for the tenant project to become active");
      await delay(1000);
    }
  }

  private async attachBilling(projectId: string): Promise<void> {
    const startedAt = performance.now();
    let retryDelayMillis = 1000;
    for (;;) {
      try {
        await this.client.request(`https://cloudbilling.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/billingInfo`, {
          method: "PUT",
          body: { billingAccountName: normalizeBillingAccount(this.config.billingAccount) },
        });
        return;
      } catch (error) {
        // A newly ACTIVE Resource Manager project can briefly be unknown to Cloud Billing.
        // Retry only its exact readiness response so account/permission failures stay loud.
        // "Briefly" is doing heavy lifting: on reseller/offline-billing organizations the
        // window is regularly longer than ten minutes, so the patience here has to exceed
        // any realistic propagation delay — this loop also backs the background pool, which
        // has no request budget to violate.
        if (!(error instanceof GcpApiError)
          || error.status !== 400
          || error.providerMessage !== "Precondition check failed."
          || performance.now() - startedAt > 20 * 60 * 1000) throw error;
        await delay(retryDelayMillis);
        retryDelayMillis = Math.min(retryDelayMillis * 2, 30_000);
      }
    }
  }

  private async enableApis(projectId: string): Promise<void> {
    const serviceIds = [...new Set([...TENANT_APIS, ...(this.config.additionalApis ?? [])])];
    const result = await this.client.request(`https://serviceusage.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/services:batchEnable`, {
      method: "POST",
      body: { serviceIds },
    });
    await this.client.waitForOperation(parseOperation(result, "service-enable"), {
      apiBaseUrl: "https://serviceusage.googleapis.com/v1/",
      timeoutMillis: 10 * 60 * 1000,
    });
  }

  private async ensureServiceIdentity(projectNumber: string, service: string): Promise<void> {
    const result = await this.client.request(`https://serviceusage.googleapis.com/v1beta1/projects/${projectNumber}/services/${service}:generateServiceIdentity`, { method: "POST", body: {} });
    if (isRecord(result) && typeof result.name === "string") {
      const operation = parseOperation(result, "service-identity");
      // Service Usage uses this sentinel when the identity already exists. It is a
      // completed operation marker, not an operation ID accepted by operations.get.
      if (operation.name === "operations/finished.DONE_OPERATION") return;
      await this.client.waitForOperation(operation, { apiBaseUrl: "https://serviceusage.googleapis.com/v1beta1/" });
    }
  }

  private async ensureRuntimeIam(projectId: string, projectNumber: string): Promise<void> {
    const policyValue = await this.client.request(`https://cloudresourcemanager.googleapis.com/v1/projects/${encodeURIComponent(projectId)}:getIamPolicy`, {
      method: "POST",
      body: { options: { requestedPolicyVersion: 3 } },
    });
    if (!isRecord(policyValue)) throw new Error(`Google Cloud returned an invalid IAM policy for project ${projectId}`);
    const existingBindings = Array.isArray(policyValue.bindings) ? policyValue.bindings : [];
    const additions = [
      { role: "roles/artifactregistry.writer", member: `serviceAccount:${projectNumber}-compute@developer.gserviceaccount.com` },
      { role: "roles/logging.logWriter", member: `serviceAccount:${projectNumber}-compute@developer.gserviceaccount.com` },
      { role: "roles/compute.networkUser", member: `serviceAccount:service-${projectNumber}@serverless-robot-prod.iam.gserviceaccount.com` },
    ];
    const bindings = existingBindings.map((binding) => {
      if (!isRecord(binding) || typeof binding.role !== "string" || !Array.isArray(binding.members)) return binding;
      const addition = additions.find((candidate) => candidate.role === binding.role);
      if (addition === undefined || binding.members.includes(addition.member)) return binding;
      return { ...binding, members: [...binding.members, addition.member] };
    });
    for (const addition of additions) {
      const alreadyPresent = bindings.some((binding) => isRecord(binding) && binding.role === addition.role && Array.isArray(binding.members) && binding.members.includes(addition.member));
      if (!alreadyPresent) bindings.push({ role: addition.role, members: [addition.member] });
    }
    await this.client.request(`https://cloudresourcemanager.googleapis.com/v1/projects/${encodeURIComponent(projectId)}:setIamPolicy`, {
      method: "POST",
      body: { policy: { ...policyValue, version: 3, bindings } },
    });
  }

  async deleteDisposableProject(projectId: string): Promise<void> {
    if (!projectId.startsWith(`${sanitizeProjectFragment(this.config.projectPrefix, 8)}-`)) {
      throw new Error(`refusing to delete project ${JSON.stringify(projectId)} because it is outside Marshal's configured project prefix`);
    }
    let deleted: unknown | null;
    try {
      // Delete first because projects.search is eventually consistent and can briefly
      // omit a project that was just created during a failed provisioning attempt.
      deleted = await this.client.request(`https://cloudresourcemanager.googleapis.com/v3/projects/${encodeURIComponent(projectId)}`, { method: "DELETE", allow404: true });
    } catch (error) {
      if (!(error instanceof GcpApiError) || error.status !== 403) throw error;
      if (await this.findProject(projectId) !== null) throw error;
      return;
    }
    if (deleted !== null) await this.client.waitForOperation(parseOperation(deleted, "project-delete"));
  }
}

export function resetTenantProjectCacheForTests(): void {
  inFlightProjects.clear();
}
