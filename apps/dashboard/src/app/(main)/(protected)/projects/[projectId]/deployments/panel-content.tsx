"use client";

import { DesignBadge, DesignButton, DesignInput, DesignMenu } from "@/components/design-components";
import { CopyButton, Label, Popover, PopoverContent, PopoverTrigger, Spinner, cn } from "@/components/ui";
import type { AdminDeploymentDomainJson, AdminDeploymentRunJson, AdminProject } from "@hexclave/next";
import { runAsynchronously, runAsynchronouslyWithAlert } from "@hexclave/shared/dist/utils/promises";
import {
  ArrowClockwiseIcon,
  ArrowSquareOutIcon,
  CaretDownIcon,
  CaretLeftIcon,
  CaretRightIcon,
  CheckCircleIcon,
  CheckIcon,
  CircleIcon,
  CircleNotchIcon,
  ClockIcon,
  LightningIcon,
  LinkSimpleIcon,
  LockSimpleIcon,
  LockSimpleOpenIcon,
  MagnifyingGlassIcon,
  PlusIcon,
  ProhibitIcon,
  RocketLaunchIcon,
  StackIcon,
  StarIcon,
  TerminalWindowIcon,
  TrashIcon,
  WarningIcon,
  XCircleIcon,
} from "@phosphor-icons/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { getServiceOutputs, type BoardService, type EnvVar } from "./board-model";
import { parseReferences } from "./connections";

type DesignBadgeColor = "blue" | "cyan" | "purple" | "green" | "orange" | "red";

// -- shared bits ------------------------------------------------------------

export function runStatusMeta(status: AdminDeploymentRunJson["status"]): { label: string, color: DesignBadgeColor, icon: React.ElementType, spin: boolean } {
  switch (status) {
    // `spin` marks the non-terminal "building" state so the CircleNotch icon
    // animates (via `animate-spin`) instead of sitting frozen mid-notch.
    case "queued": { return { label: "Queued", color: "blue", icon: ClockIcon, spin: false }; }
    case "building": { return { label: "Building", color: "cyan", icon: CircleNotchIcon, spin: true }; }
    case "ready": { return { label: "Ready", color: "green", icon: CheckCircleIcon, spin: false }; }
    case "error": { return { label: "Failed", color: "red", icon: XCircleIcon, spin: false }; }
    case "canceled": { return { label: "Cancelled", color: "orange", icon: ProhibitIcon, spin: false }; }
  }
}

function isTerminalRun(run: AdminDeploymentRunJson): boolean {
  return run.status === "ready" || run.status === "error" || run.status === "canceled";
}

function formatRunTime(millis: number): string {
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

// Framework presets for the build settings selector — searchable, each with an
// icon. Values are what the backend maps to Vercel framework slugs.
type FrameworkPreset = { value: string, icon: React.ElementType, iconClassName: string };

const FRAMEWORK_PRESETS: FrameworkPreset[] = [
  { value: "Next.js", icon: CircleIcon, iconClassName: "text-foreground" },
  { value: "Vite", icon: LightningIcon, iconClassName: "text-purple-500" },
  { value: "Astro", icon: StackIcon, iconClassName: "text-rose-500" },
];

function FrameworkSelect({ value, disabled, onChange }: { value: string, disabled?: boolean, onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const current = FRAMEWORK_PRESETS.find((f) => f.value === value);
  const CurrentIcon = current?.icon;
  const filtered = FRAMEWORK_PRESETS.filter((f) => f.value.toLowerCase().includes(query.trim().toLowerCase()));

  return (
    <Popover
      open={open && !disabled}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setQuery("");
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className={cn(
            "flex h-9 w-full items-center gap-2 rounded-xl border border-black/[0.08] bg-white/80 px-3 text-sm shadow-sm ring-1 ring-black/[0.08] transition-all duration-150 hover:bg-white hover:transition-none dark:border-white/[0.06] dark:bg-foreground/[0.03] dark:ring-white/[0.06] dark:hover:bg-foreground/[0.06]",
            disabled && "cursor-not-allowed opacity-60",
          )}
        >
          {CurrentIcon
            ? <CurrentIcon className={cn("h-4 w-4 shrink-0", current.iconClassName)} weight="fill" />
            : <span className="h-4 w-4 shrink-0" />}
          <span className={cn("min-w-0 flex-1 truncate text-left", value === "" && "text-muted-foreground")}>{current?.value ?? (value === "" ? "Auto-detect" : value)}</span>
          <CaretDownIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] p-0">
        <div className="flex items-center gap-2 border-b border-border/60 px-2.5 py-2">
          <MagnifyingGlassIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search frameworks…"
            className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground/60"
          />
        </div>
        <div className="max-h-56 overflow-y-auto p-1">
          {filtered.map((f) => {
            const FIcon = f.icon;
            const isSelected = f.value === value;
            return (
              <button
                key={f.value}
                type="button"
                onClick={() => {
                  onChange(f.value);
                  setOpen(false);
                  setQuery("");
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors duration-150 hover:bg-foreground/[0.06] hover:transition-none"
              >
                <FIcon className={cn("h-4 w-4 shrink-0", f.iconClassName)} weight="fill" />
                <span className="min-w-0 flex-1 truncate text-left">{f.value}</span>
                {isSelected && <CheckIcon className="h-4 w-4 shrink-0 text-primary" />}
              </button>
            );
          })}
          {filtered.length === 0 && (
            <div className="px-2 py-4 text-center text-xs text-muted-foreground">No frameworks found</div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
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
    "# from your project directory",
    "npx @hexclave/cli@latest login",
    `npx @hexclave/cli@latest deploy ${service.id} --cloud-project-id ${project.id}`,
  ].join("\n");

  return (
    <div className="space-y-2.5 rounded-xl bg-cyan-500/[0.05] p-3 ring-1 ring-cyan-500/20">
      <div className="flex items-center gap-2 text-sm font-medium text-foreground">
        <RocketLaunchIcon className="h-4 w-4 text-cyan-500" weight="fill" />
        Deploy your code
      </div>
      <p className="text-xs text-muted-foreground">
        This service has no deployment yet. Deploy it from your app&apos;s directory with the Hexclave CLI — the build settings you configure here are used automatically:
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
  const latestRun = service.api?.latest_run ?? null;
  const latestMeta = latestRun != null ? runStatusMeta(latestRun.status) : null;
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

      {latestRun != null && latestMeta != null && (
        <div className="space-y-1.5">
          <SectionLabel>Latest deployment</SectionLabel>
          <div className="rounded-xl bg-foreground/[0.03] p-3 ring-1 ring-black/[0.04] dark:ring-white/[0.04]">
            <div className="flex items-center gap-2">
              <DesignBadge label={latestMeta.label} color={latestMeta.color} size="sm" icon={LatestIcon} iconClassName={latestMeta.spin ? "animate-spin" : undefined} />
              <span className="text-[11px] text-muted-foreground">{latestRun.target} · {formatRunTime(latestRun.created_at_millis)} · via {latestRun.triggered_by === "server" ? "CLI" : "dashboard session"}</span>
            </div>
            {latestRun.url != null && (
              <div className="mt-2">
                <ExternalLink hostname={new URL(latestRun.url).host} />
              </div>
            )}
            {latestRun.error != null && (
              <div className="mt-2 text-xs text-red-600 dark:text-red-400">{latestRun.error}</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// -- Variables --------------------------------------------------------------

type DraftEnvVar = {
  localId: string,
  key: string,
  value: string,
  isSecret: boolean,
};

function draftsFromService(envVars: EnvVar[]): DraftEnvVar[] {
  return envVars.map((envVar) => ({ localId: envVar.id, key: envVar.key, value: envVar.value, isSecret: envVar.isSecret }));
}

function draftsEqual(a: DraftEnvVar[], b: DraftEnvVar[]): boolean {
  return a.length === b.length && a.every((envVar, i) => envVar.key === b[i].key && envVar.value === b[i].value && envVar.isSecret === b[i].isSecret);
}

export function VariablesContent({ service, services, project, isHexclave, refresh }: {
  service: BoardService,
  services: BoardService[],
  project: AdminProject,
  isHexclave: boolean,
  refresh: () => Promise<void>,
}) {
  const [drafts, setDrafts] = useState<DraftEnvVar[]>(() => draftsFromService(service.envVars));
  const [savedDrafts, setSavedDrafts] = useState<DraftEnvVar[]>(() => draftsFromService(service.envVars));
  const [saveError, setSaveError] = useState<string | null>(null);
  const localIdCounter = useRef(0);

  // Reset drafts when a different service is shown.
  const serviceIdRef = useRef(service.id);
  useEffect(() => {
    if (serviceIdRef.current !== service.id) {
      serviceIdRef.current = service.id;
      setDrafts(draftsFromService(service.envVars));
      setSavedDrafts(draftsFromService(service.envVars));
      setSaveError(null);
    }
  }, [service.id, service.envVars]);

  const dirty = !draftsEqual(drafts, savedDrafts);

  if (isHexclave) {
    return (
      <div className="h-full overflow-y-auto p-4">
        <div className="rounded-xl border border-dashed border-border bg-muted/20 px-3 py-6 text-center text-xs text-muted-foreground">
          The Hexclave service&apos;s environment is managed for you.
        </div>
      </div>
    );
  }

  const referenceItems = services
    .filter((s) => s.id !== service.id)
    .flatMap((s) =>
      getServiceOutputs(s.type).map((output) => ({
        id: `${s.name}.${output.key}`,
        label: `${s.name}.${output.key}`,
        token: `{${s.name}.${output.key}}`,
      })),
    );

  const updateDraft = (localId: string, patch: Partial<Pick<DraftEnvVar, "key" | "value" | "isSecret">>) => {
    setDrafts((prev) => prev.map((envVar) => (envVar.localId === localId ? { ...envVar, ...patch } : envVar)));
  };

  const handleSave = async () => {
    setSaveError(null);
    // Drop empty-key rows BEFORE saving and reflect that in the UI state —
    // otherwise they'd look persisted but silently vanish on the next load.
    const cleanedDrafts = drafts
      .filter((envVar) => envVar.key.trim() !== "")
      .map((envVar) => ({ ...envVar, key: envVar.key.trim() }));
    try {
      await project.updateDeploymentService(service.id, {
        env_vars: cleanedDrafts.map((envVar) => ({ key: envVar.key, value: envVar.value, is_secret: envVar.isSecret })),
      });
      setDrafts(cleanedDrafts);
      setSavedDrafts(cleanedDrafts);
      await refresh();
    } catch (error) {
      setSaveError(errorMessageOf(error));
      throw error;
    }
  };

  return (
    <div className="h-full space-y-3 overflow-y-auto p-4">
      {drafts.length === 0 && (
        <div className="rounded-xl border border-dashed border-border bg-muted/20 px-3 py-6 text-center text-xs text-muted-foreground">
          No variables yet. Add one to configure this service.
        </div>
      )}

      {drafts.map((envVar) => {
        const refs = parseReferences(envVar.value);
        return (
          <div key={envVar.localId} className="space-y-1.5 rounded-xl bg-foreground/[0.02] p-2.5 ring-1 ring-black/[0.04] dark:ring-white/[0.04]">
            <div className="flex items-center gap-1.5">
              <DesignInput value={envVar.key} size="sm" placeholder="KEY" className="font-mono" onChange={(e) => updateDraft(envVar.localId, { key: e.target.value })} />
              <DesignButton variant="ghost" size="icon" className="h-7 w-7 shrink-0 text-muted-foreground hover:text-red-500" onClick={() => setDrafts((prev) => prev.filter((e) => e.localId !== envVar.localId))} aria-label="Remove variable">
                <TrashIcon className="h-3.5 w-3.5" />
              </DesignButton>
            </div>
            <div className="flex items-center gap-1.5">
              <DesignInput
                value={envVar.value}
                size="sm"
                placeholder="value"
                className="font-mono"
                type={envVar.isSecret ? "password" : "text"}
                onChange={(e) => updateDraft(envVar.localId, { value: e.target.value })}
              />
              <DesignButton
                variant="ghost"
                size="icon"
                className={cn("h-7 w-7 shrink-0", envVar.isSecret ? "text-amber-500" : "text-muted-foreground")}
                aria-label={envVar.isSecret ? "Marked as secret (click to unmark)" : "Mark as secret"}
                onClick={() => updateDraft(envVar.localId, { isSecret: !envVar.isSecret })}
              >
                {envVar.isSecret ? <LockSimpleIcon className="h-3.5 w-3.5" weight="fill" /> : <LockSimpleOpenIcon className="h-3.5 w-3.5" />}
              </DesignButton>
              <div className="shrink-0">
                <DesignMenu
                  variant="actions"
                  trigger="icon"
                  triggerLabel="Insert reference"
                  triggerIcon={<LinkSimpleIcon className="h-4 w-4" />}
                  label="Reference an output"
                  align="end"
                  items={referenceItems.length > 0
                    ? referenceItems.map((item) => ({ id: item.id, label: item.label, onClick: () => updateDraft(envVar.localId, { value: item.token }) }))
                    : [{ id: "none", label: "No other services to reference", onClick: () => undefined }]}
                />
              </div>
            </div>
            {refs.map((ref) => (
              <ResolvedReference key={ref.raw} serviceName={ref.serviceName} outputKey={ref.outputKey} services={services} />
            ))}
          </div>
        );
      })}

      <DesignButton
        variant="outline"
        size="sm"
        className="w-full"
        onClick={() => {
          const localId = `new_${localIdCounter.current++}`;
          setDrafts((prev) => [...prev, { localId, key: "", value: "", isSecret: false }]);
        }}
      >
        <PlusIcon className="mr-2 h-4 w-4" />
        Add variable
      </DesignButton>

      {saveError != null && <InlineError message={saveError} />}

      {dirty && (
        <div className="flex items-center justify-end gap-2">
          <DesignButton
            variant="ghost"
            size="sm"
            onClick={() => {
              setDrafts(savedDrafts);
              setSaveError(null);
            }}
          >
            Discard
          </DesignButton>
          <DesignButton size="sm" onClick={handleSave}>
            Save variables
          </DesignButton>
        </div>
      )}
    </div>
  );
}

function ResolvedReference({ serviceName, outputKey, services }: { serviceName: string, outputKey: string, services: BoardService[] }) {
  const source = services.find((s) => s.name === serviceName);
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
          Linked to <span className="font-mono font-medium text-foreground">{serviceName}.{outputKey}</span>
          {output.secret ? " · secret, resolved at deploy time" : " · resolved at deploy time"}
        </span>
      ) : (
        <span className="min-w-0 truncate">Unknown reference <span className="font-mono">{serviceName}.{outputKey}</span></span>
      )}
    </div>
  );
}

// -- Deployments (list + drill-in) ------------------------------------------

// Poll while any run is still in flight so statuses update live.
const RUNS_POLL_INTERVAL_MS = 5000;

function useRuns(project: AdminProject, serviceId: string, enabled: boolean) {
  const [runs, setRuns] = useState<AdminDeploymentRunJson[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      try {
        const result = await project.listDeploymentRuns(serviceId);
        if (cancelled) return;
        setRuns(result);
        setError(null);
      } catch (loadError) {
        if (cancelled) return;
        setError(errorMessageOf(loadError));
      } finally {
        // Always reschedule while the tab is open: new runs can appear at any
        // time (a CLI deploy), and a transient fetch error must not halt
        // polling forever.
        if (!cancelled) {
          timeout = setTimeout(() => runAsynchronously(load()), RUNS_POLL_INTERVAL_MS);
        }
      }
    };
    runAsynchronously(load());
    return () => {
      cancelled = true;
      if (timeout !== undefined) clearTimeout(timeout);
    };
  }, [project, serviceId, enabled]);

  return { runs, error };
}

export function DeploymentsContent({ service, project, isHexclave, onOpenRun }: {
  service: BoardService,
  project: AdminProject,
  isHexclave: boolean,
  onOpenRun: (run: AdminDeploymentRunJson) => void,
}) {
  const { runs, error } = useRuns(project, service.id, !isHexclave);

  if (isHexclave) {
    return (
      <div className="h-full overflow-y-auto p-4">
        <div className="rounded-xl border border-dashed border-border bg-muted/20 px-3 py-6 text-center text-xs text-muted-foreground">
          The Hexclave service is deployed and updated for you.
        </div>
      </div>
    );
  }

  return (
    <div className="h-full space-y-2 overflow-y-auto p-4">
      {error != null && <InlineError message={error} />}
      {runs == null && error == null && <CenteredSpinner />}
      {runs != null && runs.length === 0 && (
        <div className="rounded-xl border border-dashed border-border bg-muted/20 px-3 py-6 text-center text-xs text-muted-foreground">
          No deployments yet. Run <span className="font-mono">hexclave deploy {service.id}</span> to create one.
        </div>
      )}
      {runs?.map((run) => {
        const meta = runStatusMeta(run.status);
        const Icon = meta.icon;
        return (
          <button
            key={run.id}
            onClick={() => onOpenRun(run)}
            className="flex w-full items-start gap-3 rounded-xl bg-foreground/[0.02] p-3 text-left ring-1 ring-black/[0.04] transition-colors duration-150 hover:bg-foreground/[0.05] hover:transition-none dark:ring-white/[0.04]"
          >
            <DesignBadge label={meta.label} color={meta.color} size="sm" icon={Icon} iconClassName={meta.spin ? "animate-spin" : undefined} contentMode="icon" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-foreground">
                {run.url != null ? new URL(run.url).host : `Deployment ${run.id.slice(0, 8)}`}
              </div>
              <div className="mt-0.5 flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
                <TerminalWindowIcon className="h-3 w-3 shrink-0" />
                <span className="truncate">via {run.triggered_by === "server" ? "CLI" : "dashboard session"}</span>
              </div>
            </div>
            <div className="shrink-0 text-right text-[11px] text-muted-foreground">
              <div>{run.target}</div>
              <div>{formatRunTime(run.created_at_millis)}</div>
            </div>
            <CaretRightIcon className="mt-1 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          </button>
        );
      })}
    </div>
  );
}

function useRunLogs(project: AdminProject, runId: string | null) {
  const [logs, setLogs] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadCounter, setReloadCounter] = useState(0);

  useEffect(() => {
    if (runId == null) return;
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
        const text = await project.getDeploymentRunLogs(runId, { signal: abortController.signal });
        if (!cancelled) setLogs(text);
      } catch (loadError) {
        if (!cancelled) setError(errorMessageOf(loadError));
      }
    });
    return () => {
      cancelled = true;
      abortController.abort();
    };
  }, [project, runId, reloadCounter]);

  return { logs, error, reload: () => setReloadCounter((c) => c + 1) };
}

export function DeploymentDetailContent({ run: initialRun, project, onBack }: { run: AdminDeploymentRunJson, project: AdminProject, onBack: () => void }) {
  // The prop is a snapshot from the runs list; keep refreshing it while the
  // run is in flight so status/url/error don't freeze at "Building".
  const [run, setRun] = useState(initialRun);
  useEffect(() => {
    setRun(initialRun);
  }, [initialRun]);
  useEffect(() => {
    if (isTerminalRun(initialRun)) return;
    let cancelled = false;
    const interval = setInterval(() => runAsynchronously(async () => {
      try {
        const runs = await project.listDeploymentRuns(initialRun.service_id);
        if (cancelled) return;
        const updated = runs.find((r) => r.id === initialRun.id);
        if (updated != null) {
          setRun(updated);
          if (isTerminalRun(updated)) clearInterval(interval);
        }
      } catch {
        // Transient refresh failure — keep the interval running and retry.
      }
    }), RUNS_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [project, initialRun]);
  const meta = runStatusMeta(run.status);
  const Icon = meta.icon;
  const { logs, error, reload } = useRunLogs(project, run.id);

  return (
    <div className="flex h-full flex-col p-4">
      <button onClick={onBack} className="mb-3 inline-flex items-center gap-1 self-start text-xs font-medium text-muted-foreground transition-colors duration-150 hover:text-foreground hover:transition-none">
        <CaretLeftIcon className="h-3.5 w-3.5" /> All deployments
      </button>

      <div className="mb-3 space-y-2">
        <div className="flex items-center gap-2">
          <DesignBadge label={meta.label} color={meta.color} size="sm" icon={Icon} iconClassName={meta.spin ? "animate-spin" : undefined} />
          <span className="text-[11px] text-muted-foreground">{run.target} · {formatRunTime(run.created_at_millis)}</span>
        </div>
        {run.url != null && <ExternalLink hostname={new URL(run.url).host} />}
        {run.error != null && <div className="text-xs text-red-600 dark:text-red-400">{run.error}</div>}
      </div>

      <div className="mb-1.5 flex items-center justify-between">
        <SectionLabel>Build logs</SectionLabel>
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

// -- Logs (live runtime log tail) -------------------------------------------

export function LogsContent({ service, project, isHexclave }: {
  service: BoardService,
  project: AdminProject,
  isHexclave: boolean,
}) {
  if (isHexclave) {
    return (
      <div className="h-full overflow-y-auto p-4">
        <div className="rounded-xl border border-dashed border-border bg-muted/20 px-3 py-6 text-center text-xs text-muted-foreground">
          The Hexclave service&apos;s logs are managed for you.
        </div>
      </div>
    );
  }

  if (service.api == null || !service.api.has_successful_deploy) {
    return (
      <div className="h-full overflow-y-auto p-4">
        <div className="rounded-xl border border-dashed border-border bg-muted/20 px-3 py-6 text-center text-xs text-muted-foreground">
          Runtime logs become available once this service has a successful deployment.
        </div>
      </div>
    );
  }

  return <RuntimeLogTail project={project} serviceId={service.id} />;
}

function RuntimeLogTail({ project, serviceId }: { project: AdminProject, serviceId: string }) {
  const [text, setText] = useState("");
  const [streamState, setStreamState] = useState<"live" | "ended" | "error">("live");
  const [error, setError] = useState<string | null>(null);
  const [restartCounter, setRestartCounter] = useState(0);

  useEffect(() => {
    let cancelled = false;
    // Aborting the fetch also cancels the response body stream, which covers
    // the window where cleanup runs before the response (or its reader) even
    // exists — a plain reader.cancel() in cleanup would leak the connection in
    // that case.
    const abortController = new AbortController();
    setText("");
    setStreamState("live");
    setError(null);
    runAsynchronously(async () => {
      try {
        // The endpoint live-tails the deployment target's runtime logs; only
        // traffic that happens while the stream is open shows up. Read
        // incrementally so lines appear as they arrive.
        const response = await project.fetchDeploymentRuntimeLogs(serviceId, { signal: abortController.signal });
        const body = response.body;
        if (body == null) throw new Error("The log stream returned no data.");
        const reader = body.getReader();
        const decoder = new TextDecoder();
        while (true) {
          const { done, value } = await reader.read();
          if (cancelled) return;
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          setText((prev) => prev + chunk);
        }
        setStreamState("ended");
      } catch (streamError) {
        if (!cancelled) {
          setStreamState("error");
          setError(errorMessageOf(streamError));
        }
      }
    });
    return () => {
      cancelled = true;
      abortController.abort();
    };
  }, [project, serviceId, restartCounter]);

  return (
    <div className="flex h-full flex-col p-4">
      <div className="mb-2 flex items-center justify-between">
        {streamState === "live" ? (
          <span className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
            </span>
            Live runtime logs — showing traffic since this tab was opened
          </span>
        ) : (
          <span className="text-xs font-medium text-muted-foreground">
            {streamState === "ended" ? "Log stream ended" : "Log stream failed"}
          </span>
        )}
        {streamState !== "live" && (
          <DesignButton variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => setRestartCounter((c) => c + 1)}>
            <ArrowClockwiseIcon className="mr-1 h-3 w-3" />
            Resume
          </DesignButton>
        )}
      </div>
      {error != null && <div className="mb-2"><InlineError message={error} /></div>}
      <LogViewer text={text === "" ? "Waiting for logs — open your deployment in the browser to generate some traffic." : text} />
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

export function DomainsContent({ service, project, isHexclave, readOnly, refresh }: {
  service: BoardService,
  project: AdminProject,
  isHexclave: boolean,
  readOnly: boolean,
  refresh: () => Promise<void>,
}) {
  const [newDomain, setNewDomain] = useState("");
  const [expandedHostname, setExpandedHostname] = useState<string | null>(null);
  const [actionError, setActionError] = useState<{ message: string, detail?: string } | null>(null);

  const domains = service.api?.domains ?? [];
  const canEdit = !isHexclave && !readOnly;

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
      {readOnly && !isHexclave && (
        <p className="text-[11px] text-muted-foreground">
          Domains are part of the service definition, which is managed by your config source. Edit your repo&apos;s <span className="font-mono">hexclave.config.ts</span> to change them.
        </p>
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

type BuildDraft = {
  framework: string,
  installCommand: string,
  buildCommand: string,
  outputDirectory: string,
  rootDirectory: string,
};

function buildDraftFromService(service: BoardService): BuildDraft {
  return {
    framework: service.api?.framework ?? "",
    installCommand: service.api?.install_command ?? "",
    buildCommand: service.api?.build_command ?? "",
    outputDirectory: service.api?.output_directory ?? "",
    rootDirectory: service.api?.root_directory ?? "",
  };
}

export function SettingsContent({ service, project, isHexclave, readOnly, refresh, onRequestDelete }: {
  service: BoardService,
  project: AdminProject,
  isHexclave: boolean,
  readOnly: boolean,
  refresh: () => Promise<void>,
  onRequestDelete: () => void,
}) {
  const [draft, setDraft] = useState<BuildDraft>(() => buildDraftFromService(service));
  const [savedDraft, setSavedDraft] = useState<BuildDraft>(() => buildDraftFromService(service));
  const [saveError, setSaveError] = useState<string | null>(null);

  const serviceIdRef = useRef(service.id);
  useEffect(() => {
    if (serviceIdRef.current !== service.id) {
      serviceIdRef.current = service.id;
      setDraft(buildDraftFromService(service));
      setSavedDraft(buildDraftFromService(service));
      setSaveError(null);
    }
  }, [service]);

  if (isHexclave) {
    return (
      <div className="h-full overflow-y-auto p-4">
        <div className="rounded-xl border border-dashed border-border bg-muted/20 px-3 py-6 text-center text-xs text-muted-foreground">
          Build settings are managed by Hexclave for this service.
        </div>
      </div>
    );
  }

  const dirty = JSON.stringify(draft) !== JSON.stringify(savedDraft);

  const fields: { key: keyof BuildDraft, label: string, placeholder: string }[] = [
    { key: "rootDirectory", label: "Root directory", placeholder: "./" },
    { key: "installCommand", label: "Install command", placeholder: "pnpm install" },
    { key: "buildCommand", label: "Build command", placeholder: "pnpm build" },
    { key: "outputDirectory", label: "Output directory", placeholder: ".next" },
  ];

  const handleSave = async () => {
    setSaveError(null);
    // An empty field means "unset" (falls back to the platform's
    // auto-detection), which the API expresses as null — sending "" would
    // store an empty string and OVERRIDE auto-detection instead.
    const valueOrNull = (value: string) => (value.trim() === "" ? null : value);
    try {
      await project.updateDeploymentService(service.id, {
        framework: valueOrNull(draft.framework),
        install_command: valueOrNull(draft.installCommand),
        build_command: valueOrNull(draft.buildCommand),
        output_directory: valueOrNull(draft.outputDirectory),
        root_directory: valueOrNull(draft.rootDirectory),
      });
      setSavedDraft(draft);
      await refresh();
    } catch (error) {
      setSaveError(errorMessageOf(error));
      throw error;
    }
  };

  return (
    <div className="h-full space-y-5 overflow-y-auto p-4">
      <div className="space-y-3">
        <SectionLabel>Build &amp; output</SectionLabel>
        {readOnly && (
          <p className="text-[11px] text-muted-foreground">
            Build settings are managed by your config source. Edit your repo&apos;s <span className="font-mono">hexclave.config.ts</span> to change them.
          </p>
        )}
        <div className="space-y-1.5">
          <Label className="block text-xs font-medium text-muted-foreground">Framework preset</Label>
          <FrameworkSelect value={draft.framework} disabled={readOnly} onChange={(v) => setDraft((d) => ({ ...d, framework: v }))} />
        </div>
        {fields.map((field) => (
          <div key={field.key} className="space-y-1.5">
            <Label className="block text-xs font-medium text-muted-foreground">{field.label}</Label>
            <DesignInput
              value={draft[field.key]}
              size="sm"
              disabled={readOnly}
              placeholder={field.placeholder}
              className="font-mono"
              onChange={(e) => setDraft((d) => ({ ...d, [field.key]: e.target.value }))}
            />
          </div>
        ))}
        {saveError != null && <InlineError message={saveError} />}
        {dirty && !readOnly && (
          <div className="flex items-center justify-end gap-2">
            <DesignButton
              variant="ghost"
              size="sm"
              onClick={() => {
                setDraft(savedDraft);
                setSaveError(null);
              }}
            >
              Discard
            </DesignButton>
            <DesignButton size="sm" onClick={handleSave}>
              Save settings
            </DesignButton>
          </div>
        )}
      </div>

      <div className="space-y-2 border-t border-border/60 pt-4">
        <SectionLabel>Danger zone</SectionLabel>
        <DesignButton
          variant="outline"
          size="sm"
          className="w-full border-red-500/30 text-red-600 hover:bg-red-500/10 dark:text-red-400"
          disabled={readOnly}
          onClick={onRequestDelete}
        >
          <TrashIcon className="mr-2 h-4 w-4" />
          Delete service
        </DesignButton>
        {readOnly && (
          <p className="text-[11px] text-muted-foreground">Remove the service from your repo&apos;s <span className="font-mono">hexclave.config.ts</span> instead.</p>
        )}
      </div>
    </div>
  );
}
