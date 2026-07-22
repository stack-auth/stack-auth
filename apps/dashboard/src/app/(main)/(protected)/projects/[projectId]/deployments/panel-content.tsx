"use client";

import { DesignBadge, DesignButton, DesignInput, DesignMenu } from "@/components/design-components";
import { Label, Popover, PopoverContent, PopoverTrigger, cn } from "@/components/ui";
import {
  ArrowSquareOutIcon,
  CaretDownIcon,
  CaretLeftIcon,
  CircleIcon,
  CircleNotchIcon,
  CheckCircleIcon,
  CheckIcon,
  ClockIcon,
  GitBranchIcon,
  LightningIcon,
  LinkSimpleIcon,
  MagnifyingGlassIcon,
  PlusIcon,
  ProhibitIcon,
  StackIcon,
  StarIcon,
  TrashIcon,
  WarningIcon,
  XCircleIcon,
} from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { parseReferences } from "./connections";
import {
  getDeploymentLogs,
  getServiceDeployments,
  getServiceLogs,
  getServiceOutputs,
  type BuildConfig,
  type Deployment,
  type DeploymentStatus,
  type EnvVar,
  type LogLine,
  type Service,
} from "./mock-data";

type DesignBadgeColor = "blue" | "cyan" | "purple" | "green" | "orange" | "red";

// -- shared bits ------------------------------------------------------------

export function deploymentStatusMeta(status: DeploymentStatus): { label: string, color: DesignBadgeColor, icon: React.ElementType } {
  switch (status) {
    case "queued": { return { label: "Queued", color: "blue", icon: ClockIcon }; }
    case "building": { return { label: "Building", color: "cyan", icon: CircleNotchIcon }; }
    case "success": { return { label: "Ready", color: "green", icon: CheckCircleIcon }; }
    case "failed": { return { label: "Failed", color: "red", icon: XCircleIcon }; }
    case "cancelled": { return { label: "Cancelled", color: "orange", icon: ProhibitIcon }; }
  }
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

// Framework presets for the build settings selector — searchable, each with an
// icon. Kept small (the common frameworks) for this UI exploration.
type FrameworkPreset = { value: string, icon: React.ElementType, iconClassName: string };

const FRAMEWORK_PRESETS: FrameworkPreset[] = [
  { value: "Next.js", icon: CircleIcon, iconClassName: "text-foreground" },
  { value: "TanStack Start", icon: StackIcon, iconClassName: "text-rose-500" },
  { value: "Vite", icon: LightningIcon, iconClassName: "text-purple-500" },
];

function FrameworkSelect({ value, onChange }: { value: string, onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const current = FRAMEWORK_PRESETS.find((f) => f.value === value);
  const CurrentIcon = current?.icon;
  const filtered = FRAMEWORK_PRESETS.filter((f) => f.value.toLowerCase().includes(query.trim().toLowerCase()));

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
          className="flex h-9 w-full items-center gap-2 rounded-xl border border-black/[0.08] bg-white/80 px-3 text-sm shadow-sm ring-1 ring-black/[0.08] transition-all duration-150 hover:bg-white hover:transition-none dark:border-white/[0.06] dark:bg-foreground/[0.03] dark:ring-white/[0.06] dark:hover:bg-foreground/[0.06]"
        >
          {CurrentIcon
            ? <CurrentIcon className={cn("h-4 w-4 shrink-0", current.iconClassName)} weight="fill" />
            : <span className="h-4 w-4 shrink-0" />}
          <span className={cn("min-w-0 flex-1 truncate text-left", !current && "text-muted-foreground")}>{current?.value ?? value}</span>
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
            const selected = f.value === value;
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
                {selected && <CheckIcon className="h-4 w-4 shrink-0 text-primary" />}
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
function LogViewer({ lines }: { lines: LogLine[] }) {
  return (
    <div className="min-h-0 flex-1 overflow-auto rounded-xl bg-[#0b0f19] p-3 font-mono text-[11px] leading-relaxed ring-1 ring-white/[0.08]">
      {lines.map((line) => (
        <div key={line.id} className="flex gap-3">
          <span className="shrink-0 tabular-nums text-white/30">{line.timestamp}</span>
          <span
            className={cn(
              "min-w-0 whitespace-pre-wrap break-words",
              line.level === "error" && "text-red-400",
              line.level === "warn" && "text-amber-400",
              line.level === "info" && "text-white/80",
            )}
          >
            {line.message}
          </span>
        </div>
      ))}
    </div>
  );
}

// -- Overview ---------------------------------------------------------------

export function OverviewContent({ service, isHexclave, onRename, shouldFocusName, onNameFocused }: {
  service: Service,
  isHexclave: boolean,
  onRename: (id: string, name: string) => void,
  shouldFocusName: boolean,
  onNameFocused: () => void,
}) {
  const primaryDomain = service.domains.find((d) => d.primary) ?? service.domains.at(0);
  const latest = getServiceDeployments(service)[0];
  const latestMeta = deploymentStatusMeta(latest.status);
  const LatestIcon = latestMeta.icon;
  const nameRef = useRef<HTMLInputElement>(null);

  // Focus + select the name of a freshly-created service so the user can name
  // it right away, then clear the one-shot request. `preventScroll` is critical:
  // the pane is still sliding in from the right when this fires, so a normal
  // focus would scroll the off-screen input into view and visibly jerk the whole
  // board sideways for a frame before it settles.
  useEffect(() => {
    if (shouldFocusName && !isHexclave) {
      nameRef.current?.focus({ preventScroll: true });
      nameRef.current?.select();
      onNameFocused();
    }
  }, [shouldFocusName, isHexclave, onNameFocused]);

  return (
    <div className="h-full space-y-5 overflow-y-auto p-4">
      <div className="space-y-2">
        <SectionLabel>Service name</SectionLabel>
        <DesignInput ref={nameRef} value={service.name} size="sm" disabled={isHexclave} onChange={(e) => onRename(service.id, e.target.value)} />
        {isHexclave && (
          <p className="text-[11px] text-muted-foreground">The Hexclave service is managed for you and can&apos;t be renamed or removed.</p>
        )}
      </div>

      {primaryDomain && (
        <div className="space-y-1.5">
          <SectionLabel>Domain</SectionLabel>
          <div>
            <ExternalLink hostname={primaryDomain.hostname} />
          </div>
        </div>
      )}

      <div className="space-y-1.5">
        <SectionLabel>Latest deployment</SectionLabel>
        <div className="rounded-xl bg-foreground/[0.03] p-3 ring-1 ring-black/[0.04] dark:ring-white/[0.04]">
          <div className="flex items-center gap-2">
            <DesignBadge label={latestMeta.label} color={latestMeta.color} size="sm" icon={LatestIcon} />
            <span className="text-[11px] text-muted-foreground">{latest.environment} · {latest.createdAtLabel}</span>
          </div>
          <div className="mt-2 truncate text-sm text-foreground">{latest.commitMessage}</div>
          <div className="mt-0.5 flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
            <GitBranchIcon className="h-3 w-3" /> {latest.branch} · {latest.commitSha}
          </div>
        </div>
      </div>
    </div>
  );
}

// -- Variables --------------------------------------------------------------

export function VariablesContent({ service, services, onAddEnvVar, onUpdateEnvVar, onRemoveEnvVar }: {
  service: Service,
  services: Service[],
  onAddEnvVar: (id: string) => void,
  onUpdateEnvVar: (id: string, envId: string, patch: Partial<Pick<EnvVar, "key" | "value">>) => void,
  onRemoveEnvVar: (id: string, envId: string) => void,
}) {
  const referenceItems = services
    .filter((s) => s.id !== service.id)
    .flatMap((s) =>
      getServiceOutputs(s.type).map((output) => ({
        id: `${s.name}.${output.key}`,
        label: `${s.name}.${output.key}`,
        token: `{${s.name}.${output.key}}`,
      })),
    );

  return (
    <div className="h-full space-y-3 overflow-y-auto p-4">
      {service.envVars.length === 0 && (
        <div className="rounded-xl border border-dashed border-border bg-muted/20 px-3 py-6 text-center text-xs text-muted-foreground">
          No variables yet. Add one to configure this service.
        </div>
      )}

      {service.envVars.map((envVar) => {
        const refs = parseReferences(envVar.value);
        return (
          <div key={envVar.id} className="space-y-1.5 rounded-xl bg-foreground/[0.02] p-2.5 ring-1 ring-black/[0.04] dark:ring-white/[0.04]">
            <div className="flex items-center gap-1.5">
              <DesignInput value={envVar.key} size="sm" placeholder="KEY" className="font-mono" onChange={(e) => onUpdateEnvVar(service.id, envVar.id, { key: e.target.value })} />
              <DesignButton variant="ghost" size="icon" className="h-7 w-7 shrink-0 text-muted-foreground hover:text-red-500" onClick={() => onRemoveEnvVar(service.id, envVar.id)} aria-label="Remove variable">
                <TrashIcon className="h-3.5 w-3.5" />
              </DesignButton>
            </div>
            <div className="flex items-center gap-1.5">
              <DesignInput value={envVar.value} size="sm" placeholder="value" className="font-mono" onChange={(e) => onUpdateEnvVar(service.id, envVar.id, { value: e.target.value })} />
              <div className="shrink-0">
                <DesignMenu
                  variant="actions"
                  trigger="icon"
                  triggerLabel="Insert reference"
                  triggerIcon={<LinkSimpleIcon className="h-4 w-4" />}
                  label="Reference an output"
                  align="end"
                  items={referenceItems.length > 0
                    ? referenceItems.map((item) => ({ id: item.id, label: item.label, onClick: () => onUpdateEnvVar(service.id, envVar.id, { value: item.token }) }))
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

      <DesignButton variant="outline" size="sm" className="w-full" onClick={() => onAddEnvVar(service.id)}>
        <PlusIcon className="mr-2 h-4 w-4" />
        Add variable
      </DesignButton>
    </div>
  );
}

function ResolvedReference({ serviceName, outputKey, services }: { serviceName: string, outputKey: string, services: Service[] }) {
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
          {output.secret ? " · hidden" : <> · <span className="font-mono">{output.sample}</span></>}
        </span>
      ) : (
        <span className="min-w-0 truncate">Unknown reference <span className="font-mono">{serviceName}.{outputKey}</span></span>
      )}
    </div>
  );
}

// -- Deployments (list + drill-in) ------------------------------------------

export function DeploymentsContent({ service, onOpenDeployment }: { service: Service, onOpenDeployment: (deployment: Deployment) => void }) {
  const deployments = getServiceDeployments(service);
  return (
    <div className="h-full space-y-2 overflow-y-auto p-4">
      {deployments.map((deployment) => {
        const meta = deploymentStatusMeta(deployment.status);
        const Icon = meta.icon;
        return (
          <button
            key={deployment.id}
            onClick={() => onOpenDeployment(deployment)}
            className="flex w-full items-start gap-3 rounded-xl bg-foreground/[0.02] p-3 text-left ring-1 ring-black/[0.04] transition-colors duration-150 hover:bg-foreground/[0.05] hover:transition-none dark:ring-white/[0.04]"
          >
            <DesignBadge label={meta.label} color={meta.color} size="sm" icon={Icon} contentMode="icon" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-foreground">{deployment.commitMessage}</div>
              <div className="mt-0.5 flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
                <GitBranchIcon className="h-3 w-3 shrink-0" />
                <span className="truncate">{deployment.branch} · {deployment.commitSha}</span>
              </div>
            </div>
            <div className="shrink-0 text-right text-[11px] text-muted-foreground">
              <div>{deployment.environment}</div>
              <div>{deployment.createdAtLabel}</div>
            </div>
          </button>
        );
      })}
    </div>
  );
}

export function DeploymentDetailContent({ deployment, onBack }: { deployment: Deployment, onBack: () => void }) {
  const meta = deploymentStatusMeta(deployment.status);
  const Icon = meta.icon;
  const logs = getDeploymentLogs(deployment);

  return (
    <div className="flex h-full flex-col p-4">
      <button onClick={onBack} className="mb-3 inline-flex items-center gap-1 self-start text-xs font-medium text-muted-foreground transition-colors duration-150 hover:text-foreground hover:transition-none">
        <CaretLeftIcon className="h-3.5 w-3.5" /> All deployments
      </button>

      <div className="mb-3 space-y-2">
        <div className="flex items-center gap-2">
          <DesignBadge label={meta.label} color={meta.color} size="sm" icon={Icon} />
          <span className="text-[11px] text-muted-foreground">{deployment.environment} · {deployment.createdAtLabel} · {deployment.durationLabel}</span>
        </div>
        <div className="text-sm font-medium text-foreground">{deployment.commitMessage}</div>
        <div className="flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
          <GitBranchIcon className="h-3 w-3" /> {deployment.branch} · {deployment.commitSha} · {deployment.author}
        </div>
      </div>

      <SectionLabel>Build logs</SectionLabel>
      <div className="mt-1.5 min-h-0 flex-1">
        <LogViewer lines={logs} />
      </div>
    </div>
  );
}

// -- Logs -------------------------------------------------------------------

export function LogsContent({ service }: { service: Service }) {
  const logs = getServiceLogs(service);
  return (
    <div className="flex h-full flex-col p-4">
      <div className="mb-2 flex items-center gap-2">
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
        </span>
        <span className="text-xs font-medium text-muted-foreground">Live runtime logs</span>
      </div>
      <LogViewer lines={logs} />
    </div>
  );
}

// -- Domains ----------------------------------------------------------------

export function DomainsContent({ service, isHexclave, onAddDomain, onRemoveDomain }: {
  service: Service,
  isHexclave: boolean,
  onAddDomain: (id: string, hostname: string) => void,
  onRemoveDomain: (id: string, domainId: string) => void,
}) {
  const [newDomain, setNewDomain] = useState("");

  const handleAdd = () => {
    const trimmed = newDomain.trim();
    if (trimmed.length === 0) return;
    onAddDomain(service.id, trimmed);
    setNewDomain("");
  };

  return (
    <div className="h-full space-y-3 overflow-y-auto p-4">
      {!isHexclave && (
        <div className="flex items-center gap-1.5">
          <DesignInput
            value={newDomain}
            size="sm"
            placeholder="app.yourdomain.com"
            className="font-mono"
            onChange={(e) => setNewDomain(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); }}
          />
          <DesignButton size="sm" variant="outline" className="shrink-0" onClick={handleAdd}>
            <PlusIcon className="mr-1.5 h-4 w-4" /> Add
          </DesignButton>
        </div>
      )}

      <div className="space-y-2">
        {service.domains.map((domain) => (
          <div key={domain.id} className="flex items-center gap-2 rounded-xl bg-foreground/[0.02] px-3 py-2.5 ring-1 ring-black/[0.04] dark:ring-white/[0.04]">
            <div className="min-w-0 flex-1">
              <ExternalLink hostname={domain.hostname} />
              <div className="mt-1 flex items-center gap-1.5">
                {domain.primary && <DesignBadge label="Primary" color="purple" size="sm" icon={StarIcon} />}
                {domain.verified
                  ? <DesignBadge label="Verified" color="green" size="sm" icon={CheckCircleIcon} />
                  : <DesignBadge label="Pending verification" color="orange" size="sm" icon={WarningIcon} />}
              </div>
            </div>
            {!isHexclave && (
              <DesignButton variant="ghost" size="icon" className="h-7 w-7 shrink-0 text-muted-foreground hover:text-red-500" onClick={() => onRemoveDomain(service.id, domain.id)} aria-label="Remove domain">
                <TrashIcon className="h-3.5 w-3.5" />
              </DesignButton>
            )}
          </div>
        ))}
      </div>

      {isHexclave && (
        <p className="text-[11px] text-muted-foreground">The Hexclave service&apos;s domain is managed for you.</p>
      )}
    </div>
  );
}

// -- Settings (build config + danger zone) ----------------------------------

export function SettingsContent({ service, isHexclave, onUpdateBuildConfig, onRequestDelete }: {
  service: Service,
  isHexclave: boolean,
  onUpdateBuildConfig: (id: string, patch: Partial<BuildConfig>) => void,
  onRequestDelete: () => void,
}) {
  if (isHexclave) {
    return (
      <div className="h-full overflow-y-auto p-4">
        <div className="rounded-xl border border-dashed border-border bg-muted/20 px-3 py-6 text-center text-xs text-muted-foreground">
          Build settings are managed by Hexclave for this service.
        </div>
      </div>
    );
  }

  const fields: { key: keyof BuildConfig, label: string, placeholder: string }[] = [
    { key: "rootDirectory", label: "Root directory", placeholder: "./" },
    { key: "installCommand", label: "Install command", placeholder: "pnpm install" },
    { key: "buildCommand", label: "Build command", placeholder: "pnpm build" },
    { key: "outputDirectory", label: "Output directory", placeholder: ".next" },
  ];

  return (
    <div className="h-full space-y-5 overflow-y-auto p-4">
      <div className="space-y-3">
        <SectionLabel>Build &amp; output</SectionLabel>
        <div className="space-y-1.5">
          <Label className="block text-xs font-medium text-muted-foreground">Framework preset</Label>
          <FrameworkSelect value={service.buildConfig.framework} onChange={(v) => onUpdateBuildConfig(service.id, { framework: v })} />
        </div>
        {fields.map((field) => (
          <div key={field.key} className="space-y-1.5">
            <Label className="block text-xs font-medium text-muted-foreground">{field.label}</Label>
            <DesignInput
              value={service.buildConfig[field.key]}
              size="sm"
              placeholder={field.placeholder}
              className="font-mono"
              onChange={(e) => onUpdateBuildConfig(service.id, { [field.key]: e.target.value })}
            />
          </div>
        ))}
      </div>

      <div className="space-y-2 border-t border-border/60 pt-4">
        <SectionLabel>Danger zone</SectionLabel>
        <DesignButton variant="outline" size="sm" className="w-full border-red-500/30 text-red-600 hover:bg-red-500/10 dark:text-red-400" onClick={onRequestDelete}>
          <TrashIcon className="mr-2 h-4 w-4" />
          Delete service
        </DesignButton>
      </div>
    </div>
  );
}

