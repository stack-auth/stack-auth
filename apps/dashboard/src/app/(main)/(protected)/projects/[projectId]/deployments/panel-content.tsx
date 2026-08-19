"use client";

import { DesignBadge, DesignButton, DesignInput } from "@/components/design-components";
import { CopyButton, Label, Spinner, cn } from "@/components/ui";
import type { AdminDeploymentDomainJson, AdminDeploymentServiceJson, AdminDeploymentServiceOutcomeJson, AdminProject } from "@hexclave/next";
import { deploymentPortOwnsStandardPorts, parseConnectionValue } from "@hexclave/shared/dist/deployments";
import { runAsynchronously, runAsynchronouslyWithAlert } from "@hexclave/shared/dist/utils/promises";
import {
  ArrowClockwiseIcon,
  ArrowSquareOutIcon,
  CaretDownIcon,
  CaretLeftIcon,
  CaretRightIcon,
  CheckCircleIcon,
  CircleNotchIcon,
  ClockIcon,
  LinkSimpleIcon,
  LockSimpleIcon,
  PlusIcon,
  ProhibitIcon,
  RocketLaunchIcon,
  StarIcon,
  TerminalWindowIcon,
  TrashIcon,
  WarningIcon,
  XCircleIcon,
} from "@phosphor-icons/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { getServiceOutputs, portEntriesOf, type BoardService, type EnvVar } from "./board-model";

type DesignBadgeColor = "blue" | "cyan" | "purple" | "green" | "orange" | "red";

// -- shared bits ------------------------------------------------------------

export function serviceStatusMeta(status: Exclude<AdminDeploymentServiceJson["status"], "not_deployed">): { label: string, color: DesignBadgeColor, icon: React.ElementType, spin: boolean } {
  switch (status) {
    case "queued": { return { label: "Queued", color: "blue", icon: ClockIcon, spin: false }; }
    case "building": { return { label: "Building", color: "cyan", icon: CircleNotchIcon, spin: true }; }
    case "deploying": { return { label: "Deploying", color: "cyan", icon: CircleNotchIcon, spin: true }; }
    case "deployed": { return { label: "Deployed", color: "green", icon: CheckCircleIcon, spin: false }; }
    case "failed": { return { label: "Failed", color: "red", icon: XCircleIcon, spin: false }; }
    case "canceled": { return { label: "Cancelled", color: "orange", icon: ProhibitIcon, spin: false }; }
  }
}

export function serviceOutcomeMeta(status: AdminDeploymentServiceOutcomeJson["status"]): { label: string, color: DesignBadgeColor, icon: React.ElementType, spin: boolean } {
  switch (status) {
    // `spin` marks the non-terminal states so the CircleNotch icon animates (via
    // `animate-spin`) instead of sitting frozen mid-notch.
    case "pending": { return { label: "Pending", color: "blue", icon: ClockIcon, spin: false }; }
    case "building": { return { label: "Building", color: "cyan", icon: CircleNotchIcon, spin: true }; }
    case "deploying": { return { label: "Deploying", color: "cyan", icon: CircleNotchIcon, spin: true }; }
    case "deployed": { return { label: "Deployed", color: "green", icon: CheckCircleIcon, spin: false }; }
    case "failed": { return { label: "Failed", color: "red", icon: XCircleIcon, spin: false }; }
    // The deploy never reached it — its build failed, or something it depends
    // on did.
    case "skipped": { return { label: "Skipped", color: "orange", icon: ProhibitIcon, spin: false }; }
  }
}

function formatDeployTime(millis: number): string {
  return new Date(millis).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function ExternalLink({ hostname, className }: { hostname: string, className?: string }) {
  return (
    <a
      href={`https://${hostname}`}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "group/link inline-flex min-w-0 items-center gap-1 font-mono text-sm text-primary hover:underline",
        className,
      )}
    >
      <span className="truncate">{hostname}</span>
      <ArrowSquareOutIcon className="h-3.5 w-3.5 shrink-0 opacity-60 transition-opacity duration-150 group-hover/link:opacity-100 group-hover/link:transition-none" />
    </a>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <Label className="block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{children}</Label>;
}

function InlineError({ message, detail }: { message: string, detail?: string }) {
  return (
    <div className="rounded-xl bg-red-500/[0.06] px-3 py-2 text-xs text-red-600 ring-1 ring-red-500/20 dark:text-red-400">
      {message}
      {detail != null && (
        <div className="mt-1 break-words font-mono text-[10px] text-red-600/70 dark:text-red-400/70">{detail}</div>
      )}
    </div>
  );
}

function CenteredSpinner() {
  return (
    <div className="flex h-24 items-center justify-center">
      <Spinner />
    </div>
  );
}

function errorMessageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// A terminal-style log viewer. Always dark (conventional for logs) so it reads
// the same in light and dark theme.
function LogViewer({ text }: { text: string }) {
  const lines = text.replace(/\n$/, "").split("\n");
  return (
    <div className="min-h-0 flex-1 overflow-auto rounded-xl bg-[#0b0f19] p-3 font-mono text-[11px] leading-relaxed ring-1 ring-white/[0.08]">
      {lines.map((line, index) => (
        <div key={index} className="min-w-0 whitespace-pre-wrap break-words text-white/80">
          {line === "" ? " " : line}
        </div>
      ))}
    </div>
  );
}

// -- Deploy-your-code CLI hint ----------------------------------------------

function CodeSnippet({ code }: { code: string }) {
  return (
    <div className="relative rounded-xl bg-[#0b0f19] p-3 pr-10 font-mono text-[11px] leading-relaxed text-white/85 ring-1 ring-white/[0.08]">
      <pre className="overflow-x-auto whitespace-pre">{code}</pre>
      <div className="absolute right-2 top-2">
        <CopyButton content={code} size="sm" />
      </div>
    </div>
  );
}

function DeployCodeHint({ service, project }: { service: BoardService, project: AdminProject }) {
  const deployCommands = [
    "# from the directory containing your hexclave.deploy.ts",
    "npx @hexclave/cli@latest login",
    `npx @hexclave/cli@latest deploy --service-id ${service.id} --cloud-project-id ${project.id}`,
  ].join("\n");

  return (
    <div className="space-y-2.5 rounded-xl bg-cyan-500/[0.05] p-3 ring-1 ring-cyan-500/20">
      <div className="flex items-center gap-2 text-sm font-medium text-foreground">
        <RocketLaunchIcon className="h-4 w-4 text-cyan-500" weight="fill" />
        Deploy your code
      </div>
      <p className="text-xs text-muted-foreground">
        This service has no deployment yet. Deploy it with the Hexclave CLI — its configuration comes from the <span className="font-mono">services</span> member of the <span className="font-mono">deployment</span> export of your <span className="font-mono">hexclave.deploy.ts</span> (omit <span className="font-mono">--service-id</span> to deploy every service):
      </p>
      <CodeSnippet code={deployCommands} />
    </div>
  );
}

// -- Overview ---------------------------------------------------------------

export function OverviewContent({ service, project, isHexclave }: {
  service: BoardService,
  project: AdminProject,
  isHexclave: boolean,
}) {
  const serviceStatus = service.api?.status ?? null;
  const latestMeta = serviceStatus == null || serviceStatus === "not_deployed" ? null : serviceStatusMeta(serviceStatus);
  const LatestIcon = latestMeta?.icon ?? ClockIcon;

  return (
    <div className="h-full space-y-5 overflow-y-auto p-4">
      <div className="space-y-2">
        <SectionLabel>Service name</SectionLabel>
        <DesignInput value={service.name} size="sm" disabled readOnly />
        {isHexclave && (
          <p className="text-[11px] text-muted-foreground">The Hexclave service is managed for you and can&apos;t be renamed or removed.</p>
        )}
      </div>

      {service.domain != null && (
        <div className="space-y-1.5">
          <SectionLabel>Domain</SectionLabel>
          <div>
            <ExternalLink hostname={service.domain} />
          </div>
        </div>
      )}

      {!isHexclave && service.api != null && !service.api.has_successful_deploy && (
        <DeployCodeHint service={service} project={project} />
      )}

      {latestMeta != null && (
        <div className="space-y-1.5">
          <SectionLabel>Latest deployment</SectionLabel>
          <div className="rounded-xl bg-foreground/[0.03] p-3 ring-1 ring-black/[0.04] dark:ring-white/[0.04]">
            <div className="flex items-center gap-2">
              <DesignBadge label={latestMeta.label} color={latestMeta.color} size="sm" icon={LatestIcon} iconClassName={latestMeta.spin ? "animate-spin" : undefined} />
              {/* Which deploy file this service came from: with several
                  repositories deploying into one project, that is the first
                  thing a reader needs in order to know where to change it. */}
              {service.api?.deployment_source_id != null && (
                <span className="font-mono text-[11px] text-muted-foreground">{service.api.deployment_source_id}</span>
              )}
            </div>
            {service.api?.url != null && (
              <div className="mt-2">
                <ExternalLink hostname={new URL(service.api.url).host} />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// -- Variables --------------------------------------------------------------

const ENV_VAR_TYPE_LABELS = new Map<EnvVar["type"], string>([
  ["plain", "Value"],
  ["secret", "Secret"],
  ["connection", "Connection"],
]);

// Read-only on purpose: env var definitions come from the `services` export of
// hexclave.deploy.ts and are synced by `hexclave deploy` — the dashboard only
// displays them. Secret VALUES are entered under Project Settings > Secrets.
export function VariablesContent({ service, services, isHexclave }: {
  service: BoardService,
  services: BoardService[],
  isHexclave: boolean,
}) {
  if (isHexclave) {
    return (
      <div className="h-full overflow-y-auto p-4">
        <div className="rounded-xl border border-dashed border-border bg-muted/20 px-3 py-6 text-center text-xs text-muted-foreground">
          The Hexclave service&apos;s environment is managed for you.
        </div>
      </div>
    );
  }

  return (
    <div className="h-full space-y-3 overflow-y-auto p-4">
      <p className="text-[11px] text-muted-foreground">
        Variables are defined in the <span className="font-mono">services</span> member of the <span className="font-mono">deployment</span> export of your <span className="font-mono">hexclave.deploy.ts</span> and synced when you run <span className="font-mono">hexclave deploy</span>. Secret values are entered under Project Settings &gt; Secrets.
      </p>

      {service.envVars.length === 0 && (
        <div className="rounded-xl border border-dashed border-border bg-muted/20 px-3 py-6 text-center text-xs text-muted-foreground">
          No variables. Add them to the service&apos;s <span className="font-mono">env</span> in your deploy file, then deploy.
        </div>
      )}

      {service.envVars.map((envVar) => (
        <div key={envVar.key} className="space-y-1.5 rounded-xl bg-foreground/[0.02] p-2.5 ring-1 ring-black/[0.04] dark:ring-white/[0.04]">
          <div className="flex items-center gap-1.5">
            <span className="min-w-0 flex-1 truncate font-mono text-xs font-medium text-foreground">{envVar.key}</span>
            <span className="shrink-0 rounded-md bg-foreground/[0.05] px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
              {ENV_VAR_TYPE_LABELS.get(envVar.type) ?? envVar.type}
            </span>
          </div>

          {envVar.type === "plain" && (
            <div className="truncate rounded-lg bg-foreground/[0.03] px-2 py-1 font-mono text-[11px] text-muted-foreground">{envVar.value}</div>
          )}

          {envVar.type === "secret" && (
            <div className="flex items-center gap-1.5 rounded-lg bg-amber-500/[0.06] px-2 py-1 text-[11px] text-muted-foreground ring-1 ring-amber-500/20">
              <LockSimpleIcon className="h-3 w-3 shrink-0 text-amber-500" weight="fill" />
              <span className="min-w-0 truncate">
                Secret <span className="font-mono text-foreground">{envVar.secretKey}</span> · value set under Project Settings &gt; Secrets
              </span>
            </div>
          )}

          {envVar.type === "connection" && envVar.value != null && (
            <ConnectionTarget value={envVar.value} services={services} />
          )}
        </div>
      ))}
    </div>
  );
}

function ConnectionTarget({ value, services }: { value: string, services: BoardService[] }) {
  // The SHARED parser: a reference may carry a `:<port>` suffix
  // (`api.internalUrl:9090`), and splitting on the dot alone would leave
  // "internalUrl:9090" as the output key and render every such value as unknown.
  const parsed = parseConnectionValue(value);
  const serviceId = parsed?.serviceId ?? value;
  const outputKey = parsed?.outputKey ?? "";
  const source = services.find((s) => s.id === serviceId);
  const output = source ? getServiceOutputs(source.type).find((o) => o.key === outputKey) : undefined;
  const resolved = source != null && output != null;

  return (
    <div className={cn(
      "flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11px]",
      resolved ? "bg-primary/[0.06] text-muted-foreground ring-1 ring-primary/15" : "bg-red-500/[0.06] text-red-600 ring-1 ring-red-500/20 dark:text-red-400",
    )}>
      <LinkSimpleIcon className="h-3 w-3 shrink-0" />
      {resolved ? (
        <span className="min-w-0 truncate">
          Linked to <span className="font-mono font-medium text-foreground">{serviceId}.{outputKey}{parsed?.port == null ? "" : `:${parsed.port}`}</span>
          {output.secret ? " · secret, resolved at deploy time" : " · resolved at deploy time"}
        </span>
      ) : (
        <span className="min-w-0 truncate">Unknown output <span className="font-mono">{value}</span></span>
      )}
    </div>
  );
}

// -- Build logs -------------------------------------------------------------
//
// A tab in the service detail pane. The page is scoped to one deployment, so the run shown

function useDeploymentBuildLogs(project: AdminProject, deploymentId: string | null) {
  const [logs, setLogs] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadCounter, setReloadCounter] = useState(0);

  useEffect(() => {
    if (deploymentId == null) return;
    let cancelled = false;
    const abortController = new AbortController();
    setLogs(null);
    setError(null);
    runAsynchronously(async () => {
      try {
        // The request follows a running build server-side, so it can take a
        // while to resolve — the spinner stays up until the logs are complete.
        // Abort on cleanup so an abandoned view doesn't keep the server
        // following the build for minutes.
        const text = await project.getDeploymentBuildLogs(deploymentId, { signal: abortController.signal });
        if (!cancelled) setLogs(text);
      } catch (loadError) {
        if (!cancelled) setError(errorMessageOf(loadError));
      }
    });
    return () => {
      cancelled = true;
      abortController.abort();
    };
  }, [project, deploymentId, reloadCounter]);

  return { logs, error, reload: () => setReloadCounter((c) => c + 1) };
}

export function BuildLogsContent({ deploymentId, hasBuildLogs, outcome, project, isHexclave }: {
  // The deployment whose build produced this service's image. One deploy is one
  // build — every service of the deployment source is built by the same machine
  // — so the log below is that build's, not this service's alone.
  deploymentId: string | null,
  // Whether that deploy built anything. A deploy whose every service runs an
  // already-built image starts no builder, so there is no log to fetch — and
  // fetching anyway would render an empty stream that looks like a failure.
  hasBuildLogs: boolean,
  outcome: AdminDeploymentServiceOutcomeJson | null,
  project: AdminProject,
  isHexclave: boolean,
}) {
  // Hooks first: useDeploymentBuildLogs has to run on every render, so the
  // "nothing to show" cases below are returned after it rather than
  // short-circuiting above it.
  const { logs, error, reload } = useDeploymentBuildLogs(project, isHexclave || !hasBuildLogs ? null : deploymentId);

  if (isHexclave) {
    return (
      <div className="h-full overflow-y-auto p-4">
        <div className="rounded-xl border border-dashed border-border bg-muted/20 px-3 py-6 text-center text-xs text-muted-foreground">
          The Hexclave service is deployed and updated for you, so it has no build of its own.
        </div>
      </div>
    );
  }

  if (deploymentId != null && !hasBuildLogs) {
    return (
      <div className="h-full overflow-y-auto p-4">
        <div className="rounded-xl border border-dashed border-border bg-muted/20 px-3 py-6 text-center text-xs text-muted-foreground">
          Nothing was built for this deploy — every service in it runs an already-built image.
        </div>
      </div>
    );
  }

  if (deploymentId == null) {
    return (
      <div className="h-full overflow-y-auto p-4">
        <div className="rounded-xl border border-dashed border-border bg-muted/20 px-3 py-6 text-center text-xs text-muted-foreground">
          This service has not been deployed yet, so there are no build logs.
        </div>
      </div>
    );
  }

  const meta = outcome === null ? null : serviceOutcomeMeta(outcome.status);
  const Icon = meta?.icon ?? ClockIcon;

  return (
    <div className="flex h-full flex-col p-4">
      <div className="mb-3 space-y-2">
        {meta !== null && (
          <div className="flex items-center gap-2">
            <DesignBadge label={meta.label} color={meta.color} size="sm" icon={Icon} iconClassName={meta.spin ? "animate-spin" : undefined} />
            {outcome?.revision != null && <span className="font-mono text-[11px] text-muted-foreground">{outcome.revision}</span>}
          </div>
        )}
        {/* What this deploy actually ran, digest-pinned. The tag an author wrote
            and the bytes that ran are different facts, and only this one explains
            a deploy that behaved unexpectedly. */}
        {outcome?.image != null && (
          <div className="truncate font-mono text-[11px] text-muted-foreground" title={outcome.image}>{outcome.image}</div>
        )}
        {outcome?.url != null && <ExternalLink hostname={new URL(outcome.url).host} />}
        {outcome?.error != null && <div className="text-xs text-red-600 dark:text-red-400">{outcome.error}</div>}
      </div>

      <div className="mb-1.5 flex items-center justify-between">
        {/* One log for the whole deploy: say so, or a reader looking for this
            service's lines will think the others leaked in. */}
        <SectionLabel>Build logs (all services of this deploy)</SectionLabel>
        <DesignButton variant="ghost" size="icon" className="h-6 w-6" onClick={reload} aria-label="Reload logs">
          <ArrowClockwiseIcon className="h-3.5 w-3.5" />
        </DesignButton>
      </div>
      <div className="flex min-h-0 flex-1 flex-col">
        {error != null && <InlineError message={error} />}
        {logs == null && error == null && <CenteredSpinner />}
        {logs != null && <LogViewer text={logs === "" ? "(no build logs)" : logs} />}
      </div>
    </div>
  );
}

// -- Domains ----------------------------------------------------------------

// Refresh a pending domain's verification periodically while its details are
// expanded — verification flips when the user creates the DNS records.
const DOMAIN_POLL_INTERVAL_MS = 10_000;

function DomainDetails({ project, serviceId, hostname, onVerifiedChange }: {
  project: AdminProject,
  serviceId: string,
  hostname: string,
  onVerifiedChange: () => Promise<void>,
}) {
  const [details, setDetails] = useState<AdminDeploymentDomainJson | null>(null);
  const [error, setError] = useState<string | null>(null);
  const wasVerifiedRef = useRef<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      try {
        const result = await project.getDeploymentServiceDomain(serviceId, hostname);
        if (cancelled) return;
        setDetails(result);
        setError(null);
        if (wasVerifiedRef.current === false && result.verified) {
          // Freshly verified: let the board refresh so badges update.
          runAsynchronouslyWithAlert(onVerifiedChange());
        }
        wasVerifiedRef.current = result.verified;
        if (!result.verified) {
          timeout = setTimeout(() => runAsynchronously(load()), DOMAIN_POLL_INTERVAL_MS);
        }
      } catch (loadError) {
        if (cancelled) return;
        setError(errorMessageOf(loadError));
      }
    };
    runAsynchronously(load());
    return () => {
      cancelled = true;
      if (timeout !== undefined) clearTimeout(timeout);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, serviceId, hostname]);

  if (error != null) {
    return (
      <InlineError
        message="We couldn't check this domain's status. Make sure it's a real domain name — you can remove it and add it again."
        detail={error}
      />
    );
  }
  if (details == null) return <CenteredSpinner />;

  return (
    <div className="space-y-2">
      {details.pending_first_deploy && (
        <p className="text-[11px] text-muted-foreground">
          This service hasn&apos;t been deployed yet — the domain will be registered with the deployment target on the first deploy. You can already create these DNS records:
        </p>
      )}
      {details.verified ? (
        <p className="text-[11px] text-muted-foreground">DNS is configured correctly — no records needed.</p>
      ) : (
        <div className="overflow-hidden rounded-lg ring-1 ring-black/[0.06] dark:ring-white/[0.06]">
          <table className="w-full text-left text-[11px]">
            <thead>
              <tr className="bg-foreground/[0.04] text-muted-foreground">
                <th className="px-2 py-1.5 font-medium">Type</th>
                <th className="px-2 py-1.5 font-medium">Name</th>
                <th className="px-2 py-1.5 font-medium">Value</th>
                <th className="w-8 px-2 py-1.5" />
              </tr>
            </thead>
            <tbody>
              {details.dns_records.map((record, index) => (
                <tr key={index} className="border-t border-border/40 font-mono">
                  <td className="px-2 py-1.5 text-foreground">{record.type}</td>
                  <td className="max-w-32 truncate px-2 py-1.5 text-foreground">{record.name}</td>
                  <td className="max-w-40 truncate px-2 py-1.5 text-foreground">{record.value}</td>
                  <td className="px-1 py-1">
                    <CopyButton content={`${record.type} ${record.name} ${record.value}`} size="sm" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!details.verified && (
        <p className="text-[11px] text-muted-foreground">
          Checking automatically — verification usually completes within a few minutes of creating the records.
        </p>
      )}
    </div>
  );
}

export function DomainsContent({ service, project, isHexclave, refresh }: {
  service: BoardService,
  project: AdminProject,
  isHexclave: boolean,
  refresh: () => Promise<void>,
}) {
  const [newDomain, setNewDomain] = useState("");
  const [expandedHostname, setExpandedHostname] = useState<string | null>(null);
  const [actionError, setActionError] = useState<{ message: string, detail?: string } | null>(null);

  const domains = service.api?.domains ?? [];
  // Domains are operational state (not part of the config-managed definition),
  // so they stay editable even when the config comes from a file or GitHub.
  const canEdit = !isHexclave;

  const handleAdd = useCallback(async () => {
    const trimmed = newDomain.trim().toLowerCase();
    if (trimmed.length === 0) return;
    setActionError(null);
    try {
      await project.addDeploymentServiceDomain(service.id, trimmed);
      setNewDomain("");
      await refresh();
      setExpandedHostname(trimmed);
    } catch (error) {
      setActionError({
        message: `We couldn't add "${trimmed}". Check that it's a real domain name you own (like app.example.com) and try again.`,
        detail: errorMessageOf(error),
      });
    }
  }, [newDomain, project, service.id, refresh]);

  return (
    <div className="h-full space-y-3 overflow-y-auto p-4">
      {canEdit && (
        <div className="flex items-center gap-1.5">
          <DesignInput
            value={newDomain}
            size="sm"
            placeholder="app.yourdomain.com"
            className="font-mono"
            onChange={(e) => setNewDomain(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") runAsynchronouslyWithAlert(handleAdd()); }}
          />
          <DesignButton size="sm" variant="outline" className="shrink-0" onClick={handleAdd}>
            <PlusIcon className="mr-1.5 h-4 w-4" /> Add
          </DesignButton>
        </div>
      )}
      {actionError != null && <InlineError message={actionError.message} detail={actionError.detail} />}

      <div className="space-y-2">
        {domains.map((domain) => {
          const expanded = expandedHostname === domain.hostname;
          return (
            <div key={domain.hostname} className="rounded-xl bg-foreground/[0.02] ring-1 ring-black/[0.04] dark:ring-white/[0.04]">
              <div className="flex items-center gap-2 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <ExternalLink hostname={domain.hostname} />
                  <div className="mt-1 flex items-center gap-1.5">
                    {domain.is_primary && <DesignBadge label="Primary" color="purple" size="sm" icon={StarIcon} />}
                    {domain.verified
                      ? <DesignBadge label="Verified" color="green" size="sm" icon={CheckCircleIcon} />
                      : <DesignBadge label="Pending verification" color="orange" size="sm" icon={WarningIcon} />}
                  </div>
                </div>
                <DesignButton
                  variant="ghost"
                  size="sm"
                  className="h-7 shrink-0 px-2 text-xs text-muted-foreground"
                  onClick={() => setExpandedHostname(expanded ? null : domain.hostname)}
                >
                  DNS
                  <CaretDownIcon className={cn("ml-1 h-3 w-3 transition-transform duration-150", expanded && "rotate-180")} />
                </DesignButton>
                {canEdit && (
                  <DesignButton
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 shrink-0 text-muted-foreground hover:text-red-500"
                    aria-label="Remove domain"
                    onClick={async () => {
                      setActionError(null);
                      try {
                        await project.deleteDeploymentServiceDomain(service.id, domain.hostname);
                        await refresh();
                      } catch (error) {
                        setActionError({
                          message: `We couldn't remove "${domain.hostname}" right now. Please try again.`,
                          detail: errorMessageOf(error),
                        });
                      }
                    }}
                  >
                    <TrashIcon className="h-3.5 w-3.5" />
                  </DesignButton>
                )}
              </div>
              {expanded && (
                <div className="border-t border-border/40 px-3 py-2.5">
                  <DomainDetails project={project} serviceId={service.id} hostname={domain.hostname} onVerifiedChange={refresh} />
                </div>
              )}
            </div>
          );
        })}
        {domains.length === 0 && !isHexclave && (
          <div className="rounded-xl border border-dashed border-border bg-muted/20 px-3 py-6 text-center text-xs text-muted-foreground">
            No custom domains yet.
          </div>
        )}
      </div>

      {isHexclave && (
        <p className="text-[11px] text-muted-foreground">The Hexclave service&apos;s domain is managed for you.</p>
      )}
    </div>
  );
}

// -- Settings (build config + danger zone) ----------------------------------

// Read-only on purpose (like the Variables tab): build settings come from the
// `services` export of hexclave.deploy.ts and are synced by `hexclave deploy`.
export function SettingsContent({ service, isHexclave }: {
  service: BoardService,
  isHexclave: boolean,
}) {
  if (isHexclave) {
    return (
      <div className="h-full overflow-y-auto p-4">
        <div className="rounded-xl border border-dashed border-border bg-muted/20 px-3 py-6 text-center text-xs text-muted-foreground">
          Container settings are managed by Hexclave for this service.
        </div>
      </div>
    );
  }

  const servicePorts = portEntriesOf(service.api?.ports ?? {});
  const isPublic = service.api?.public === true;
  // A service either runs an already-built image or is built from the source, so
  // the two describe the same slot and only one of them has anything to say. The
  // source rows on an image service would read "./" and "None (Railpack
  // auto-detected build)" — both false, and the second actively misleading.
  const prebuiltImage = service.api?.image ?? null;
  // `fallback` is optional: the Image row below only exists when it has a value,
  // so a fallback for it would be unreachable.
  const fields: { label: string, value: string | null | undefined, fallback?: string }[] = [
    ...(prebuiltImage !== null ? [
      { label: "Image", value: prebuiltImage },
    ] : [
      { label: "Root directory", value: service.api?.root_directory, fallback: "./" },
      // A missing dockerfile_path means "Railpack build" only once a definition was actually
      // synced — before that (there are no ports either) it just means "not synced yet".
      { label: "Dockerfile", value: service.api?.dockerfile_path, fallback: servicePorts.length > 0 ? "None (Railpack auto-detected build)" : "Not synced yet" },
    ]),
    // Visibility is the SERVICE's, so it gets a row of its own rather than being
    // repeated on every port.
    { label: "Visibility", value: service.api == null ? undefined : service.api.public ? "Public" : "Private", fallback: "Not synced yet" },
    // Every port the container listens on. On a public service with SEVERAL
    // ports the one owning 80/443 is called out, since it is the port the
    // service's URL points at and the only one a custom domain can front — not
    // something a reader can work out from a list of numbers.
    {
      label: servicePorts.length === 1 ? "Container port" : "Container ports",
      value: servicePorts.length > 0
        ? servicePorts.map((entry) => `${entry.port}${isPublic && servicePorts.length > 1 && deploymentPortOwnsStandardPorts(service.api?.ports ?? {}, isPublic, entry.port) ? " · 80/443" : ""}${entry.protocol === "tcp" ? " · tcp" : ""}`).join(", ")
        : undefined,
      fallback: "Not synced yet",
    },
    { label: "Min instances", value: service.api?.min_instances?.toString(), fallback: "0 (scale to zero)" },
    // Mirrors the deploy-time default (`max_instances ?? Math.max(min_instances, 1)`): a
    // service that declares only `minInstances: 3` really does run with a max of 3, so a
    // flat "1" here would contradict the fleet the user gets.
    { label: "Max instances", value: service.api?.max_instances?.toString(), fallback: Math.max(service.api?.min_instances ?? 0, 1).toString() },
    // No "Dev command" row: `devCommand` is consumed locally by `hexclave dev`
    // and never sent to the server, so there is nothing here to show.
  ];

  return (
    <div className="h-full space-y-5 overflow-y-auto p-4">
      <div className="space-y-3">
        <SectionLabel>Container</SectionLabel>
        <p className="text-[11px] text-muted-foreground">
          Container settings are defined in the <span className="font-mono">services</span> member of the <span className="font-mono">deployment</span> export of your <span className="font-mono">hexclave.deploy.ts</span> and synced when you run <span className="font-mono">hexclave deploy</span>. {prebuiltImage !== null
            ? <>This service runs an already-built image, so nothing is built for it; each deploy pins the tag to the exact image it resolved to.</>
            : <>The image is built from the service&apos;s Dockerfile when <span className="font-mono">dockerfilePath</span> is set, and auto-detected with Railpack otherwise.</>}
        </p>
        {fields.map((field) => (
          <div key={field.label} className="space-y-1.5">
            <Label className="block text-xs font-medium text-muted-foreground">{field.label}</Label>
            <div className={cn(
              "truncate rounded-lg bg-foreground/[0.03] px-2.5 py-1.5 font-mono text-xs ring-1 ring-black/[0.04] dark:ring-white/[0.04]",
              field.value != null && field.value !== "" ? "text-foreground" : "text-muted-foreground",
            )}>
              {field.value != null && field.value !== "" ? field.value : field.fallback ?? ""}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
