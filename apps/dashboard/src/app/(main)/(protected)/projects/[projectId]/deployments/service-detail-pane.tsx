"use client";

import { DesignBadge, DesignButton } from "@/components/design-components";
import { ActionDialog, Typography, cn } from "@/components/ui";
import { XIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { getServiceTypeMeta, type BuildConfig, type Deployment, type EnvVar, type Service } from "./mock-data";
import {
  DeploymentDetailContent,
  DeploymentsContent,
  DomainsContent,
  LogsContent,
  OverviewContent,
  SettingsContent,
  VariablesContent,
} from "./panel-content";
import { STATUS_META, getAccentClasses } from "./variants";

type ServiceDetailPaneProps = {
  service: Service,
  services: Service[],
  shouldFocusName: boolean,
  onNameFocused: () => void,
  onClose: () => void,
  onRename: (id: string, name: string) => void,
  onAddEnvVar: (id: string) => void,
  onUpdateEnvVar: (id: string, envId: string, patch: Partial<Pick<EnvVar, "key" | "value">>) => void,
  onRemoveEnvVar: (id: string, envId: string) => void,
  onDeleteService: (id: string) => void,
  onAddDomain: (id: string, hostname: string) => void,
  onRemoveDomain: (id: string, domainId: string) => void,
  onUpdateBuildConfig: (id: string, patch: Partial<BuildConfig>) => void,
};

type PanelTabId = "overview" | "variables" | "deployments" | "logs" | "domains" | "settings";

const TABS: { id: PanelTabId, label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "variables", label: "Variables" },
  { id: "deployments", label: "Deployments" },
  { id: "logs", label: "Logs" },
  { id: "domains", label: "Domains" },
  { id: "settings", label: "Settings" },
];

export function ServiceDetailPane(props: ServiceDetailPaneProps) {
  const { service, services } = props;
  const [tab, setTab] = useState<PanelTabId>("overview");
  const [openDeployment, setOpenDeployment] = useState<Deployment | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const isHexclave = service.type === "hexclave";
  const meta = getServiceTypeMeta(service.type);
  const accent = getAccentClasses(meta.accent);
  const Icon = meta.icon;
  const status = STATUS_META.get(service.status);

  // When a different service is selected, jump back to Overview so a freshly
  // created service shows its name field, and reset the drill-in / dialog.
  useEffect(() => {
    setOpenDeployment(null);
    setDeleteOpen(false);
    if (props.shouldFocusName) setTab("overview");
  }, [service.id, props.shouldFocusName]);

  const selectTab = (id: PanelTabId) => {
    setTab(id);
    setOpenDeployment(null);
  };

  const content = openDeployment ? (
    <DeploymentDetailContent deployment={openDeployment} onBack={() => setOpenDeployment(null)} />
  ) : (() => {
    switch (tab) {
      case "overview": { return <OverviewContent service={service} isHexclave={isHexclave} onRename={props.onRename} shouldFocusName={props.shouldFocusName} onNameFocused={props.onNameFocused} />; }
      case "variables": { return <VariablesContent service={service} services={services} onAddEnvVar={props.onAddEnvVar} onUpdateEnvVar={props.onUpdateEnvVar} onRemoveEnvVar={props.onRemoveEnvVar} />; }
      case "deployments": { return <DeploymentsContent service={service} onOpenDeployment={setOpenDeployment} />; }
      case "logs": { return <LogsContent service={service} />; }
      case "domains": { return <DomainsContent service={service} isHexclave={isHexclave} onAddDomain={props.onAddDomain} onRemoveDomain={props.onRemoveDomain} />; }
      case "settings": { return <SettingsContent service={service} isHexclave={isHexclave} onUpdateBuildConfig={props.onUpdateBuildConfig} onRequestDelete={() => setDeleteOpen(true)} />; }
    }
  })();

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex items-start gap-3 border-b border-border/60 p-4">
        <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl", accent.chip)}>
          <Icon className="h-5 w-5" weight="fill" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <DesignBadge label={meta.label} color={meta.accent} size="sm" />
            {status && <DesignBadge label={status.label} color={status.color} size="sm" />}
          </div>
          <Typography type="h3" className="mt-1 truncate text-base font-semibold">{service.name}</Typography>
        </div>
        <DesignButton variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={props.onClose} aria-label="Close">
          <XIcon className="h-4 w-4" />
        </DesignButton>
      </div>

      <div className="flex gap-0.5 overflow-x-auto border-b border-border/60 px-1.5">
        {TABS.map((t) => {
          const active = tab === t.id && !openDeployment;
          return (
            <button
              key={t.id}
              onClick={() => selectTab(t.id)}
              className={cn(
                "relative flex shrink-0 whitespace-nowrap px-2.5 py-2 text-xs font-medium transition-colors duration-150 hover:transition-none",
                active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t.label}
              {active && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-primary" />}
            </button>
          );
        })}
      </div>

      <div className="min-h-0 flex-1">{content}</div>

      <ActionDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        danger
        title="Delete service"
        description={`This permanently removes "${service.name}" and all of its configuration. This can't be undone.`}
        okButton={{ label: "Delete service", onClick: async () => { props.onDeleteService(service.id); } }}
        cancelButton
      />
    </div>
  );
}
