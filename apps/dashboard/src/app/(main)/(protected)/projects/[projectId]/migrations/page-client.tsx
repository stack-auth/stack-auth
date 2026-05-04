"use client";

import { DesignAlert, DesignBadge, DesignButton, DesignCard, DesignInput, DesignSelectorDropdown } from "@/components/design-components";
import { stackAppInternalsSymbol } from "@/lib/stack-app-internals";
import { cn } from "@/lib/utils";
import { ArrowsClockwiseIcon, CheckCircleIcon, ClockIcon, CloudArrowUpIcon, DatabaseIcon, KeyIcon, PlugsIcon, XCircleIcon } from "@phosphor-icons/react";
import { runAsynchronously } from "@stackframe/stack-shared/dist/utils/promises";
import { Result } from "@stackframe/stack-shared/dist/utils/results";
import { urlString } from "@stackframe/stack-shared/dist/utils/urls";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PageLayout } from "../page-layout";
import { useAdminApp } from "../use-admin-app";

const providerConfigs = [
  { id: "workos", label: "WorkOS", detail: "API key + org filters" },
  { id: "clerk", label: "Clerk", detail: "Backend secret key" },
  { id: "authjs", label: "Auth.js", detail: "Database connection" },
  { id: "auth0", label: "Auth0", detail: "Management API app" },
  { id: "supabase", label: "Supabase", detail: "Service role key" },
  { id: "better_auth", label: "Better Auth", detail: "Database connection" },
] as const;

type ProviderId = typeof providerConfigs[number]["id"];
type JobStatus = "PENDING" | "RUNNING" | "WAITING_RETRY" | "SUCCEEDED" | "FAILED";

type AuthMigrationJob = {
  id: string,
  provider: ProviderId,
  status: JobStatus,
  attempt_count: number,
  max_attempts: number,
  next_attempt_at_millis: number | null,
  started_at_millis: number | null,
  finished_at_millis: number | null,
  last_error_external_message: string | null,
  result: unknown,
  created_at_millis: number,
  updated_at_millis: number,
};

type AdminAppInternals = {
  sendRequest: (path: string, requestOptions: RequestInit, requestType?: "client" | "server" | "admin") => Promise<Response>,
};

const statusCopy = new Map<JobStatus, { label: string, color: "blue" | "green" | "orange" | "red" }>([
  ["PENDING", { label: "Queued", color: "blue" }],
  ["RUNNING", { label: "Running", color: "orange" }],
  ["WAITING_RETRY", { label: "Retrying", color: "orange" }],
  ["SUCCEEDED", { label: "Succeeded", color: "green" }],
  ["FAILED", { label: "Failed", color: "red" }],
]);

type CredentialField = {
  key: string,
  label: string,
  placeholder: string,
  type?: "text" | "password",
  optional?: boolean,
};

const providerCredentialFields: Record<ProviderId, CredentialField[]> = {
  workos: [
    { key: "api_key", label: "WorkOS API key", placeholder: "sk_test_...", type: "password" },
    { key: "organization_id", label: "Organization ID", placeholder: "org_...", optional: true },
    { key: "directory_id", label: "Directory ID", placeholder: "directory_...", optional: true },
  ],
  clerk: [
    { key: "secret_key", label: "Clerk secret key", placeholder: "sk_test_...", type: "password" },
    { key: "api_base_url", label: "API base URL", placeholder: "https://api.clerk.com/v1", optional: true },
  ],
  authjs: [
    { key: "database_url", label: "Auth.js database URL", placeholder: "postgres://user:password@host:5432/db", type: "password" },
    { key: "users_table", label: "Users table", placeholder: "users", optional: true },
    { key: "accounts_table", label: "Accounts table", placeholder: "accounts", optional: true },
  ],
  auth0: [
    { key: "domain", label: "Auth0 domain", placeholder: "your-tenant.us.auth0.com" },
    { key: "client_id", label: "Management API client ID", placeholder: "client id" },
    { key: "client_secret", label: "Management API client secret", placeholder: "client secret", type: "password" },
    { key: "connection_id", label: "Connection ID", placeholder: "con_...", optional: true },
  ],
  supabase: [
    { key: "project_url", label: "Project URL", placeholder: "https://project-ref.supabase.co" },
    { key: "service_role_key", label: "Service role key", placeholder: "eyJ...", type: "password" },
  ],
  better_auth: [
    { key: "database_url", label: "Better Auth database URL", placeholder: "postgres://user:password@host:5432/db", type: "password" },
    { key: "schema", label: "Schema", placeholder: "public", optional: true },
  ],
};

type ProviderMapRow = {
  id: string,
  sourceProviderId: string,
  stackProviderId: string,
};

function isProviderId(value: string): value is ProviderId {
  return providerConfigs.some((provider) => provider.id === value);
}

function getAdminAppInternals(adminApp: ReturnType<typeof useAdminApp>): AdminAppInternals {
  const internals = Reflect.get(adminApp, stackAppInternalsSymbol);
  if (typeof internals !== "object" || internals === null) {
    throw new Error("Stack Admin App internals are unavailable.");
  }
  const sendRequest = Reflect.get(internals, "sendRequest");
  if (typeof sendRequest !== "function") {
    throw new Error("Stack Admin App sendRequest internals are unavailable.");
  }
  return {
    sendRequest: async (path, requestOptions, requestType) => {
      const response: unknown = await sendRequest(path, requestOptions, requestType);
      if (!(response instanceof Response)) {
        throw new Error("Stack Admin App sendRequest returned an unexpected value.");
      }
      return response;
    },
  };
}

function getProviderConfig(providerId: ProviderId) {
  const provider = providerConfigs.find((config) => config.id === providerId);
  if (provider == null) throw new Error(`Missing provider config for ${providerId}`);
  return provider;
}

function isJobStatus(value: unknown): value is JobStatus {
  return value === "PENDING" || value === "RUNNING" || value === "WAITING_RETRY" || value === "SUCCEEDED" || value === "FAILED";
}

function isAuthMigrationJob(value: unknown): value is AuthMigrationJob {
  if (typeof value !== "object" || value === null) return false;
  const id = Reflect.get(value, "id");
  const provider = Reflect.get(value, "provider");
  const status = Reflect.get(value, "status");
  const attemptCount = Reflect.get(value, "attempt_count");
  const maxAttempts = Reflect.get(value, "max_attempts");
  const nextAttemptAtMillis = Reflect.get(value, "next_attempt_at_millis");
  const startedAtMillis = Reflect.get(value, "started_at_millis");
  const finishedAtMillis = Reflect.get(value, "finished_at_millis");
  const lastErrorExternalMessage = Reflect.get(value, "last_error_external_message");
  const createdAtMillis = Reflect.get(value, "created_at_millis");
  const updatedAtMillis = Reflect.get(value, "updated_at_millis");
  return typeof id === "string"
    && typeof provider === "string"
    && isProviderId(provider)
    && isJobStatus(status)
    && typeof attemptCount === "number"
    && typeof maxAttempts === "number"
    && (typeof nextAttemptAtMillis === "number" || nextAttemptAtMillis === null)
    && (typeof startedAtMillis === "number" || startedAtMillis === null)
    && (typeof finishedAtMillis === "number" || finishedAtMillis === null)
    && (typeof lastErrorExternalMessage === "string" || lastErrorExternalMessage === null)
    && typeof createdAtMillis === "number"
    && typeof updatedAtMillis === "number";
}

function parseJobsResponse(value: unknown): AuthMigrationJob[] {
  if (typeof value !== "object" || value === null || !("items" in value) || !Array.isArray(value.items)) {
    throw new Error("Unexpected auth migration list response.");
  }
  if (!value.items.every(isAuthMigrationJob)) {
    throw new Error("Auth migration list response contained an invalid job.");
  }
  return value.items;
}

function buildProviderIdMap(rows: ProviderMapRow[]): Record<string, string> | undefined {
  const providerIdMap: Record<string, string> = {};
  for (const row of rows) {
    const sourceProviderId = row.sourceProviderId.trim();
    const stackProviderId = row.stackProviderId.trim();
    if (sourceProviderId === "" && stackProviderId === "") {
      continue;
    }
    if (sourceProviderId === "" || stackProviderId === "") {
      throw new Error("OAuth provider map rows need both a source provider ID and a Stack Auth provider ID.");
    }
    providerIdMap[sourceProviderId] = stackProviderId;
  }
  return Object.keys(providerIdMap).length > 0 ? providerIdMap : undefined;
}

function buildCredentials(provider: ProviderId, credentialValues: Record<string, string>): Record<string, unknown> {
  const credentials: Record<string, unknown> = {};
  for (const field of providerCredentialFields[provider]) {
    const fieldId = `${provider}.${field.key}`;
    const value = (Object.hasOwn(credentialValues, fieldId) ? credentialValues[fieldId] : "").trim();
    if (value === "") {
      if (field.optional === true) continue;
      throw new Error(`${field.label} is required.`);
    }
    credentials[field.key] = value;
  }
  return credentials;
}

function formatTimestamp(millis: number | null) {
  if (millis == null) return "—";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(millis));
}

function getStatusMeta(status: JobStatus) {
  const meta = statusCopy.get(status);
  if (meta == null) throw new Error(`Missing migration status metadata for ${status}`);
  return meta;
}

function countStatus(jobs: AuthMigrationJob[], status: JobStatus) {
  return jobs.filter((job) => job.status === status).length;
}

function getImportedCount(jobs: AuthMigrationJob[]) {
  return jobs.filter((job) => job.status === "SUCCEEDED").length;
}

export default function PageClient() {
  const adminApp = useAdminApp();
  const adminAppInternals = useMemo(() => getAdminAppInternals(adminApp), [adminApp]);
  const [selectedProvider, setSelectedProvider] = useState<ProviderId>("workos");
  const [unsupportedPasswordHashAction, setUnsupportedPasswordHashAction] = useState("error");
  const [credentialValues, setCredentialValues] = useState<Record<string, string>>({});
  const [providerMapRows, setProviderMapRows] = useState<ProviderMapRow[]>([
    { id: "default", sourceProviderId: "", stackProviderId: "" },
  ]);
  const [jobs, setJobs] = useState<AuthMigrationJob[]>([]);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [loadingJobs, setLoadingJobs] = useState(true);
  const [queueing, setQueueing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlightRef = useRef(false);

  const selectedProviderConfig = getProviderConfig(selectedProvider);
  const selectedJob: AuthMigrationJob | null = jobs.find((job) => job.id === selectedJobId) ?? (jobs.length > 0 ? jobs[0] : null);

  const loadJobs = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setLoadingJobs(true);

    const result = await Result.fromPromise((async () => {
      const response = await adminAppInternals.sendRequest(
        urlString`/internal/auth-migrations`,
        { method: "GET" },
        "admin",
      );
      const body: unknown = await response.json();
      if (!response.ok) {
        const message = typeof body === "object" && body !== null && "error" in body && typeof body.error === "string" ? body.error : "Failed to load migration jobs.";
        throw new Error(message);
      }
      return parseJobsResponse(body);
    })());

    inFlightRef.current = false;
    setLoadingJobs(false);

    if (result.status === "error") {
      setError(result.error instanceof Error ? result.error.message : String(result.error));
      return;
    }

    setJobs(result.data);
    setSelectedJobId((current) => current ?? (result.data.length > 0 ? result.data[0].id : null));
    setError(null);
  }, [adminAppInternals]);

  useEffect(() => {
    runAsynchronously(loadJobs());
  }, [loadJobs]);

  const queueMigration = useCallback(async () => {
    setQueueing(true);
    const result = await Result.fromPromise((async () => {
      const credentials = buildCredentials(selectedProvider, credentialValues);
      const providerIdMap = buildProviderIdMap(providerMapRows);
      const body = {
        provider: selectedProvider,
        credentials: {
          ...credentials,
          unsupported_password_hash_action: unsupportedPasswordHashAction,
          ...(providerIdMap != null ? { provider_id_map: providerIdMap } : {}),
        },
      };

      const response = await adminAppInternals.sendRequest(
        urlString`/internal/auth-migrations`,
        {
          method: "POST",
          body: JSON.stringify(body),
          headers: { "content-type": "application/json" },
        },
        "admin",
      );
      const responseBody: unknown = await response.json();
      if (!response.ok) {
        const message = typeof responseBody === "object" && responseBody !== null && "error" in responseBody && typeof responseBody.error === "string" ? responseBody.error : "Failed to queue migration job.";
        throw new Error(message);
      }
      if (!isAuthMigrationJob(responseBody)) {
        throw new Error("Unexpected auth migration create response.");
      }
      return responseBody;
    })());
    setQueueing(false);

    if (result.status === "error") {
      setError(result.error instanceof Error ? result.error.message : String(result.error));
      return;
    }

    setJobs((current) => [result.data, ...current]);
    setSelectedJobId(result.data.id);
    setError(null);
  }, [adminAppInternals, credentialValues, providerMapRows, selectedProvider, unsupportedPasswordHashAction]);

  const retrySelectedJob = useCallback(async () => {
    if (selectedJob == null) return;
    const result = await Result.fromPromise((async () => {
      const response = await adminAppInternals.sendRequest(
        urlString`/internal/auth-migrations/${selectedJob.id}/retry`,
        { method: "POST" },
        "admin",
      );
      const body: unknown = await response.json();
      if (!response.ok) {
        const message = typeof body === "object" && body !== null && "error" in body && typeof body.error === "string" ? body.error : "Failed to retry migration job.";
        throw new Error(message);
      }
      if (!isAuthMigrationJob(body)) {
        throw new Error("Unexpected auth migration retry response.");
      }
      return body;
    })());

    if (result.status === "error") {
      setError(result.error instanceof Error ? result.error.message : String(result.error));
      return;
    }

    setJobs((current) => current.map((job) => job.id === result.data.id ? result.data : job));
    setError(null);
  }, [adminAppInternals, selectedJob]);

  const stats = useMemo(() => [
    { label: "Queued", value: countStatus(jobs, "PENDING"), icon: ClockIcon, color: "blue" as const },
    { label: "Running", value: countStatus(jobs, "RUNNING"), icon: ArrowsClockwiseIcon, color: "orange" as const },
    { label: "Failed", value: countStatus(jobs, "FAILED"), icon: XCircleIcon, color: "red" as const },
    { label: "Imported jobs", value: getImportedCount(jobs), icon: CheckCircleIcon, color: "green" as const },
  ], [jobs]);

  return (
    <PageLayout
      title="Migrations"
      description="Queue provider imports into Stack Auth. Credentials stay backend-owned and worker retries are handled server-side."
      actions={
        <DesignButton variant="secondary" size="sm" onClick={loadJobs} loading={loadingJobs}>
          <ArrowsClockwiseIcon className="h-4 w-4" />
          Refresh
        </DesignButton>
      }
    >
      {error != null && (
        <DesignAlert variant="error" title="Migration action failed" description={error} />
      )}

      <div className="grid gap-3 md:grid-cols-4">
        {stats.map((stat) => (
          <DesignCard key={stat.label} glassmorphic contentClassName="p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{stat.label}</div>
                <div className="text-2xl font-semibold tabular-nums">{stat.value}</div>
              </div>
              <div className={cn(
                "flex h-8 w-8 items-center justify-center rounded-xl border",
                stat.color === "green" && "border-emerald-500/25 bg-emerald-500/10 text-emerald-500",
                stat.color === "orange" && "border-amber-500/25 bg-amber-500/10 text-amber-500",
                stat.color === "red" && "border-red-500/25 bg-red-500/10 text-red-500",
                stat.color === "blue" && "border-cyan-500/25 bg-cyan-500/10 text-cyan-500",
              )}>
                <stat.icon className="h-4 w-4" />
              </div>
            </div>
          </DesignCard>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <DesignCard title="Provider migration" subtitle="Select the source provider and enter the credentials Stack Auth should use to pull and normalize the import." icon={CloudArrowUpIcon} glassmorphic>
          <div className="space-y-5">
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {providerConfigs.map((provider) => {
                const selected = provider.id === selectedProvider;
                return (
                  <button
                    key={provider.id}
                    type="button"
                    onClick={() => setSelectedProvider(provider.id)}
                    className={cn(
                      "flex min-h-20 items-start justify-between rounded-2xl border px-3 py-3 text-left transition-colors duration-150 hover:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      selected ? "border-cyan-500/50 bg-cyan-500/10" : "border-border bg-foreground/[0.02] hover:bg-foreground/[0.05]",
                    )}
                  >
                    <span className="min-w-0 space-y-1">
                      <span className="block text-sm font-medium">{provider.label}</span>
                      <span className="block text-xs text-muted-foreground">{provider.detail}</span>
                    </span>
                    <DesignBadge label="Credential import" color="blue" size="sm" />
                  </button>
                );
              })}
            </div>

            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
              <div className="space-y-4">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Source credentials</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    Stack Auth will use these credentials on the backend to fetch from {selectedProviderConfig.label} and convert the data into Stack Auth users and teams.
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  {providerCredentialFields[selectedProvider].map((field) => {
                    const fieldId = `${selectedProvider}.${field.key}`;
                    return (
                      <label key={field.key} className="space-y-1.5" htmlFor={fieldId}>
                        <span className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
                          {field.label}
                          {field.optional === true && <span className="text-[10px] uppercase tracking-wider">Optional</span>}
                        </span>
                        <DesignInput
                          id={fieldId}
                          type={field.type ?? "text"}
                          value={credentialValues[fieldId] ?? ""}
                          placeholder={field.placeholder}
                          onChange={(event) => setCredentialValues((current) => ({
                            ...current,
                            [fieldId]: event.target.value,
                          }))}
                        />
                      </label>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-4">
                <div className="space-y-2">
                  <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    OAuth provider map
                  </div>
                  <div className="space-y-2">
                    {providerMapRows.map((row) => (
                      <div key={row.id} className="grid grid-cols-[1fr_1fr] gap-2">
                        <DesignInput
                          value={row.sourceProviderId}
                          placeholder="source id"
                          onChange={(event) => setProviderMapRows((current) => current.map((item) => item.id === row.id ? { ...item, sourceProviderId: event.target.value } : item))}
                        />
                        <DesignInput
                          value={row.stackProviderId}
                          placeholder="stack id"
                          onChange={(event) => setProviderMapRows((current) => current.map((item) => item.id === row.id ? { ...item, stackProviderId: event.target.value } : item))}
                        />
                      </div>
                    ))}
                    <DesignButton
                      variant="secondary"
                      size="sm"
                      onClick={() => setProviderMapRows((current) => [...current, { id: crypto.randomUUID(), sourceProviderId: "", stackProviderId: "" }])}
                    >
                      Add mapping
                    </DesignButton>
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Password hashes</div>
                  <DesignSelectorDropdown
                    value={unsupportedPasswordHashAction}
                    onValueChange={setUnsupportedPasswordHashAction}
                    size="md"
                    options={[
                      { value: "error", label: "Fail on unsupported hashes" },
                      { value: "omit", label: "Omit unsupported hashes" },
                    ]}
                  />
                </div>

                <DesignAlert
                  variant="info"
                  title="Encrypted at rest"
                  description="Submitted provider credentials are encrypted before they enter the migration job queue."
                />
              </div>
            </div>

            <div className="flex flex-col gap-2 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-xs text-muted-foreground">
                Queue the job and the backend will pull from the source provider, normalize the data, and import it into this Stack Auth project branch.
              </div>
              <DesignButton onClick={queueMigration} loading={queueing}>
                <CloudArrowUpIcon className="h-4 w-4" />
                Queue migration
              </DesignButton>
            </div>
          </div>
        </DesignCard>

        <DesignCard title="Selected job" subtitle="Worker state and retry details." icon={DatabaseIcon} glassmorphic>
          {selectedJob == null ? (
            <div className="flex min-h-64 flex-col items-center justify-center rounded-2xl border border-dashed border-border text-center">
              <PlugsIcon className="mb-2 h-8 w-8 text-muted-foreground" />
              <div className="text-sm font-medium">No jobs queued</div>
              <div className="mt-1 max-w-52 text-xs text-muted-foreground">Queue a migration to inspect attempts, failures, and import counts.</div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-start justify-between gap-3 rounded-2xl border border-border bg-foreground/[0.02] p-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{getProviderConfig(selectedJob.provider).label}</div>
                  <div className="mt-1 truncate font-mono text-[11px] text-muted-foreground">{selectedJob.id}</div>
                </div>
                <DesignBadge label={getStatusMeta(selectedJob.status).label} color={getStatusMeta(selectedJob.status).color} size="sm" />
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs">
                <JobDetail label="Attempts" value={`${selectedJob.attempt_count} / ${selectedJob.max_attempts}`} />
                <JobDetail label="Created" value={formatTimestamp(selectedJob.created_at_millis)} />
                <JobDetail label="Next retry" value={formatTimestamp(selectedJob.next_attempt_at_millis)} />
                <JobDetail label="Finished" value={formatTimestamp(selectedJob.finished_at_millis)} />
              </div>

              {selectedJob.last_error_external_message != null && (
                <DesignAlert variant="error" title="Last error" description={selectedJob.last_error_external_message} />
              )}

              <div className="space-y-2">
                <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Worker timeline</div>
                {(["PENDING", "RUNNING", "WAITING_RETRY", "SUCCEEDED"] as const).map((status) => (
                  <TimelineRow key={status} active={selectedJob.status === status} complete={selectedJob.status === "SUCCEEDED"} label={getStatusMeta(status).label} />
                ))}
              </div>

              <DesignButton
                variant="secondary"
                size="sm"
                disabled={selectedJob.status !== "FAILED" && selectedJob.status !== "WAITING_RETRY"}
                onClick={retrySelectedJob}
              >
                <ArrowsClockwiseIcon className="h-4 w-4" />
                Retry job
              </DesignButton>
            </div>
          )}
        </DesignCard>
      </div>

      <DesignCard title="Recent jobs" subtitle="Backend queue state for this project branch." icon={KeyIcon} glassmorphic>
        {jobs.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            {loadingJobs ? "Loading migration jobs..." : "No migration jobs yet."}
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-border">
            <div className="grid grid-cols-[1fr_120px_110px_120px_90px] gap-3 border-b border-border bg-foreground/[0.03] px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              <div>Provider</div>
              <div>Status</div>
              <div>Attempts</div>
              <div>Created</div>
              <div className="text-right">Actions</div>
            </div>
            {jobs.map((job) => {
              const statusMeta = getStatusMeta(job.status);
              return (
                <button
                  key={job.id}
                  type="button"
                  onClick={() => setSelectedJobId(job.id)}
                  className={cn(
                    "grid w-full grid-cols-[1fr_120px_110px_120px_90px] gap-3 border-b border-border px-4 py-3 text-left text-sm transition-colors duration-150 last:border-b-0 hover:bg-foreground/[0.04] hover:transition-none",
                    selectedJob != null && selectedJob.id === job.id && "bg-cyan-500/10",
                  )}
                >
                  <div className="min-w-0">
                    <div className="truncate font-medium">{getProviderConfig(job.provider).label}</div>
                    <div className="truncate font-mono text-[11px] text-muted-foreground">{job.id}</div>
                  </div>
                  <div><DesignBadge label={statusMeta.label} color={statusMeta.color} size="sm" /></div>
                  <div className="text-muted-foreground tabular-nums">{job.attempt_count} / {job.max_attempts}</div>
                  <div className="text-muted-foreground">{formatTimestamp(job.created_at_millis)}</div>
                  <div className="text-right text-xs text-muted-foreground">Inspect</div>
                </button>
              );
            })}
          </div>
        )}
      </DesignCard>
    </PageLayout>
  );
}

function JobDetail(props: { label: string, value: string }) {
  return (
    <div className="rounded-xl border border-border bg-foreground/[0.02] p-3">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{props.label}</div>
      <div className="mt-1 truncate font-medium tabular-nums">{props.value}</div>
    </div>
  );
}

function TimelineRow(props: { active: boolean, complete: boolean, label: string }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <div className={cn(
        "h-2.5 w-2.5 rounded-full border",
        props.complete ? "border-emerald-500 bg-emerald-500" : props.active ? "border-cyan-500 bg-cyan-500" : "border-border bg-foreground/[0.04]",
      )} />
      <span className={cn((props.active || props.complete) ? "text-foreground" : "text-muted-foreground")}>{props.label}</span>
    </div>
  );
}
