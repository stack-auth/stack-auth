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
  // Every secret env var needs its value passed at deploy time, so bake the
  // flags into the copyable command instead of letting the first deploy fail
  // with a missing-secret error. Deduplicated: several env vars may reference
  // the SAME secret key, but the CLI rejects repeated --secret keys.
  const secretFlags = [...new Set(service.envVars
    .flatMap((envVar) => envVar.type === "secret" && envVar.secretKey != null && envVar.secretKey !== "" ? [envVar.secretKey] : []))]
    .map((secretKey) => ` --secret ${secretKey}=<value>`)
    .join("");
  const deployCommands = [
    "# from your project directory",
    "npx @hexclave/cli@latest login",
    `npx @hexclave/cli@latest deploy ${service.id} --cloud-project-id ${project.id}${secretFlags}`,
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

type DraftEnvVarType = "plain" | "secret" | "connection";

type DraftEnvVar = {
  localId: string,
  key: string,
  type: DraftEnvVarType,
  // Literal value for plain vars, "serviceId.outputKey" for connections.
  value: string,
  // The secret's name for secret vars — its VALUE is supplied at deploy time
  // via `hexclave deploy --secret <key>=<value>` and never shown here.
  secretKey: string,
};

const ENV_VAR_TYPE_OPTIONS: { id: DraftEnvVarType, label: string }[] = [
  { id: "plain", label: "Value" },
  { id: "secret", label: "Secret" },
  { id: "connection", label: "Connection" },
];

// Must match the backend's secret key validation.
const SECRET_KEY_REGEX = /^[a-zA-Z0-9_-]+$/;

function draftsFromService(envVars: EnvVar[]): DraftEnvVar[] {
  return envVars.map((envVar) => ({
    localId: `existing_${envVar.key}`,
    key: envVar.key,
    type: envVar.type,
    value: envVar.value ?? "",
    secretKey: envVar.secretKey ?? "",
  }));
}

function draftsEqual(a: DraftEnvVar[], b: DraftEnvVar[]): boolean {
  return a.length === b.length && a.every((envVar, i) => envVar.key === b[i].key && envVar.type === b[i].type && envVar.value === b[i].value && envVar.secretKey === b[i].secretKey);
}

export function VariablesContent({ service, services, project, isHexclave, readOnly, refresh }: {
  service: BoardService,
  services: BoardService[],
  project: AdminProject,
  isHexclave: boolean,
  readOnly: boolean,
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

  // The board polls in the background, so the SAME service's env set can
  // change under an open tab (e.g. a CLI config-as-code deploy). While the
  // tab is pristine, follow along — otherwise Discard would restore stale
  // data and a later Save would silently revert the concurrent change.
  // Unsaved edits always win over the poll.
  useEffect(() => {
    if (serviceIdRef.current !== service.id) return;
    if (dirty) return;
    const fresh = draftsFromService(service.envVars);
    if (draftsEqual(fresh, savedDrafts)) return;
    setDrafts(fresh);
    setSavedDrafts(fresh);
  }, [service.id, service.envVars, dirty, savedDrafts]);

  if (isHexclave) {
    return (
      <div className="h-full overflow-y-auto p-4">
        <div className="rounded-xl border border-dashed border-border bg-muted/20 px-3 py-6 text-center text-xs text-muted-foreground">
          The Hexclave service&apos;s environment is managed for you.
        </div>
      </div>
    );
  }

  // Keyed by service ID (not display name) — the stored connection value is a
  // server-side id reference.
  const connectionTargets = services
    .filter((s) => s.id !== service.id)
    .flatMap((s) =>
      getServiceOutputs(s.type).map((output) => ({
        id: `${s.id}.${output.key}`,
        label: `${s.id}.${output.key}`,
      })),
    );

  const updateDraft = (localId: string, patch: Partial<Pick<DraftEnvVar, "key" | "type" | "value" | "secretKey">>) => {
    setDrafts((prev) => prev.map((envVar) => (envVar.localId === localId ? { ...envVar, ...patch } : envVar)));
  };

  const handleSave = async () => {
    setSaveError(null);
    // Drop empty-key rows BEFORE saving and reflect that in the UI state —
    // otherwise they'd look persisted but silently vanish on the next load.
    const cleanedDrafts = drafts
      .filter((envVar) => envVar.key.trim() !== "")
      .map((envVar) => ({ ...envVar, key: envVar.key.trim(), secretKey: envVar.secretKey.trim() }));
    // Local validation failures surface inline only (no rethrow — the button
    // wrapper would additionally pop a raw generic alert on top).
    // The env set is saved as a record keyed by the env var key, so duplicate
    // keys would silently overwrite each other — reject them instead.
    const duplicateKey = cleanedDrafts.map((envVar) => envVar.key).find((key, i, keys) => keys.indexOf(key) !== i);
    if (duplicateKey != null) {
      setSaveError(`Duplicate variable key "${duplicateKey}". Each variable needs a unique key.`);
      return;
    }
    for (const envVar of cleanedDrafts) {
      if (envVar.type === "secret" && !SECRET_KEY_REGEX.test(envVar.secretKey)) {
        setSaveError(`The secret variable "${envVar.key}" needs a secret name (letters, numbers, underscores, and hyphens) to pass at deploy time.`);
        return;
      }
      if (envVar.type === "connection" && envVar.value === "") {
        setSaveError(`The connection variable "${envVar.key}" needs a service output to connect to.`);
        return;
      }
    }
    try {
      await project.updateDeploymentService(service.id, {
        env: Object.fromEntries(cleanedDrafts.map((envVar) => [
          envVar.key,
          envVar.type === "secret"
            ? { type: "secret" as const, key: envVar.secretKey }
            : envVar.type === "connection"
              ? { type: "connection" as const, value: envVar.value }
              : { value: envVar.value },
        ])),
      });
      setSavedDrafts(cleanedDrafts);
      // Functional update rather than the click-time snapshot: keystrokes
      // typed while the request was in flight must survive the save (they
      // simply leave the tab dirty again). Only mirror the cleanup itself.
      setDrafts((prev) => prev
        .filter((envVar) => envVar.key.trim() !== "")
        .map((envVar) => ({ ...envVar, key: envVar.key.trim(), secretKey: envVar.secretKey.trim() })));
      await refresh();
    } catch (error) {
      setSaveError(errorMessageOf(error));
      throw error;
    }
  };

  return (
    <div className="h-full space-y-3 overflow-y-auto p-4">
      {readOnly && (
        <p className="text-[11px] text-muted-foreground">
          Variables are part of the service definition, which is managed by your config source. Edit the <span className="font-mono">env</span> section of your repo&apos;s <span className="font-mono">hexclave.config.ts</span> to change them.
        </p>
      )}

      {drafts.length === 0 && (
        <div className="rounded-xl border border-dashed border-border bg-muted/20 px-3 py-6 text-center text-xs text-muted-foreground">
          No variables yet.{readOnly ? "" : " Add one to configure this service."}
        </div>
      )}

      {drafts.map((envVar) => (
        <div key={envVar.localId} className="space-y-1.5 rounded-xl bg-foreground/[0.02] p-2.5 ring-1 ring-black/[0.04] dark:ring-white/[0.04]">
          <div className="flex items-center gap-1.5">
            <DesignInput value={envVar.key} size="sm" placeholder="KEY" className="font-mono" disabled={readOnly} onChange={(e) => updateDraft(envVar.localId, { key: e.target.value })} />
            {!readOnly && (
              <>
                <div className="shrink-0">
                  <DesignMenu
                    variant="selector"
                    trigger="button"
                    triggerLabel={ENV_VAR_TYPE_OPTIONS.find((o) => o.id === envVar.type)?.label ?? envVar.type}
                    label="Variable type"
                    align="end"
                    options={ENV_VAR_TYPE_OPTIONS}
                    value={envVar.type}
                    onValueChange={(value) => updateDraft(envVar.localId, { type: value as DraftEnvVarType })}
                  />
                </div>
                <DesignButton variant="ghost" size="icon" className="h-7 w-7 shrink-0 text-muted-foreground hover:text-red-500" onClick={() => setDrafts((prev) => prev.filter((e) => e.localId !== envVar.localId))} aria-label="Remove variable">
                  <TrashIcon className="h-3.5 w-3.5" />
                </DesignButton>
              </>
            )}
          </div>

          {envVar.type === "plain" && (
            <DesignInput
              value={envVar.value}
              size="sm"
              placeholder="value"
              className="font-mono"
              disabled={readOnly}
              onChange={(e) => updateDraft(envVar.localId, { value: e.target.value })}
            />
          )}

          {envVar.type === "secret" && (
            <>
              <DesignInput
                value={envVar.secretKey}
                size="sm"
                placeholder="secret name, e.g. db_connection"
                className="font-mono"
                disabled={readOnly}
                onChange={(e) => updateDraft(envVar.localId, { secretKey: e.target.value })}
              />
              <div className="flex items-center gap-1.5 rounded-lg bg-amber-500/[0.06] px-2 py-1 text-[11px] text-muted-foreground ring-1 ring-amber-500/20">
                <LockSimpleIcon className="h-3 w-3 shrink-0 text-amber-500" weight="fill" />
                <span className="min-w-0 truncate">
                  Value is supplied at deploy time: <span className="font-mono text-foreground">--secret {envVar.secretKey === "" ? "<name>" : envVar.secretKey}=&lt;value&gt;</span>
                </span>
              </div>
            </>
          )}

          {envVar.type === "connection" && (
            <>
              {!readOnly && (
                <ConnectionSelect
                  value={envVar.value}
                  options={connectionTargets}
                  onChange={(value) => updateDraft(envVar.localId, { value })}
                />
              )}
              {envVar.value !== "" && <ConnectionTarget value={envVar.value} services={services} />}
            </>
          )}
        </div>
      ))}

      {!readOnly && (
        <DesignButton
          variant="outline"
          size="sm"
          className="w-full"
          onClick={() => {
            const localId = `new_${localIdCounter.current++}`;
            setDrafts((prev) => [...prev, { localId, key: "", type: "plain", value: "", secretKey: "" }]);
          }}
        >
          <PlusIcon className="mr-2 h-4 w-4" />
          Add variable
        </DesignButton>
      )}

      {saveError != null && <InlineError message={saveError} />}

      {dirty && !readOnly && (
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

// Searchable output picker for connection env vars — same combobox pattern as
// FrameworkSelect above. A plain dropdown menu doesn't cut it here: a board
// can have many services × outputs, so the list must be height-capped,
// scrollable, and filterable.
function ConnectionSelect({ value, options, onChange }: {
  value: string,
  options: { id: string, label: string }[],
  onChange: (value: string) => void,
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const filtered = options.filter((option) => option.label.toLowerCase().includes(query.trim().toLowerCase()));

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setQuery("");
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex h-8 w-full items-center gap-2 rounded-xl border border-black/[0.08] bg-white/80 px-3 shadow-sm ring-1 ring-black/[0.08] transition-all duration-150 hover:bg-white hover:transition-none dark:border-white/[0.06] dark:bg-foreground/[0.03] dark:ring-white/[0.06] dark:hover:bg-foreground/[0.06]"
        >
          <LinkSimpleIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className={cn("min-w-0 flex-1 truncate text-left font-mono text-xs", value === "" && "font-sans text-sm text-muted-foreground")}>
            {value === "" ? "Select an output…" : value}
          </span>
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
            placeholder="Search outputs…"
            className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground/60"
          />
        </div>
        <div className="max-h-56 overflow-y-auto p-1">
          {filtered.map((option) => {
            const isSelected = option.id === value;
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => {
                  onChange(option.id);
                  setOpen(false);
                  setQuery("");
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 font-mono text-xs transition-colors duration-150 hover:bg-foreground/[0.06] hover:transition-none"
              >
                <span className="min-w-0 flex-1 truncate text-left">{option.label}</span>
                {isSelected && <CheckIcon className="h-4 w-4 shrink-0 text-primary" />}
              </button>
            );
          })}
          {filtered.length === 0 && (
            <div className="px-2 py-4 text-center text-xs text-muted-foreground">
              {options.length === 0 ? "No other services to connect to" : "No outputs found"}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function ConnectionTarget({ value, services }: { value: string, services: BoardService[] }) {
  const dotIndex = value.indexOf(".");
  const serviceId = dotIndex > 0 ? value.slice(0, dotIndex) : value;
  const outputKey = dotIndex > 0 ? value.slice(dotIndex + 1) : "";
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
          Linked to <span className="font-mono font-medium text-foreground">{serviceId}.{outputKey}</span>
          {output.secret ? " · secret, resolved at deploy time" : " · resolved at deploy time"}
        </span>
      ) : (
        <span className="min-w-0 truncate">Unknown output <span className="font-mono">{value}</span></span>
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

  const dirty = JSON.stringify(draft) !== JSON.stringify(savedDraft);

  // Same follow-the-poll-while-pristine behavior as the Variables tab: build
  // settings can change under an open tab via a CLI config-as-code deploy.
  useEffect(() => {
    if (serviceIdRef.current !== service.id) return;
    if (dirty) return;
    const fresh = buildDraftFromService(service);
    if (JSON.stringify(fresh) === JSON.stringify(savedDraft)) return;
    setDraft(fresh);
    setSavedDraft(fresh);
  }, [service, dirty, savedDraft]);

  if (isHexclave) {
    return (
      <div className="h-full overflow-y-auto p-4">
        <div className="rounded-xl border border-dashed border-border bg-muted/20 px-3 py-6 text-center text-xs text-muted-foreground">
          Build settings are managed by Hexclave for this service.
        </div>
      </div>
    );
  }

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
