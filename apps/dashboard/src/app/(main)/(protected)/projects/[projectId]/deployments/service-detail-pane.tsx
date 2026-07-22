"use client";

import { DesignBadge, DesignButton } from "@/components/design-components";
import { ActionDialog, Typography, cn } from "@/components/ui";
import type { AdminDeploymentRunJson, AdminProject } from "@hexclave/next";
import { XIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { getServiceTypeMeta, type BoardService } from "./board-model";
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
  service: BoardService,
  services: BoardService[],
  project: AdminProject,
  // True when the project's config is pushed from a config file or GitHub:
  // service definitions (name, build config, domains) can't be edited here.
  readOnly: boolean,
  onClose: () => void,
  onDeleted: () => void,
  refresh: () => Promise<void>,
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
  const { service, services, project, readOnly, refresh } = props;
  const [tab, setTab] = useState<PanelTabId>("overview");
  const [openRun, setOpenRun] = useState<AdminDeploymentRunJson | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const isHexclave = service.type === "hexclave";
  const meta = getServiceTypeMeta(service.type);
  const accent = getAccentClasses(meta.accent);
  const Icon = meta.icon;
  const status = STATUS_META.get(service.status);

  // When a different service is selected, jump back to Overview and reset the
  // drill-in / dialog.
  useEffect(() => {
    setTab("overview");
    setOpenRun(null);
    setDeleteOpen(false);
  }, [service.id]);

  const selectTab = (id: PanelTabId) => {
    setTab(id);
    setOpenRun(null);
  };

  const content = openRun ? (
    <DeploymentDetailContent run={openRun} project={project} onBack={() => setOpenRun(null)} />
  ) : (() => {
    switch (tab) {
      case "overview": { return <OverviewContent service={service} project={project} isHexclave={isHexclave} />; }
      case "variables": { return <VariablesContent service={service} services={services} project={project} isHexclave={isHexclave} refresh={refresh} />; }
      case "deployments": { return <DeploymentsContent service={service} project={project} isHexclave={isHexclave} onOpenRun={setOpenRun} />; }
      case "logs": { return <LogsContent service={service} project={project} isHexclave={isHexclave} />; }
      case "domains": { return <DomainsContent service={service} project={project} isHexclave={isHexclave} readOnly={readOnly} refresh={refresh} />; }
      case "settings": { return <SettingsContent service={service} project={project} isHexclave={isHexclave} readOnly={readOnly} refresh={refresh} onRequestDelete={() => setDeleteOpen(true)} />; }
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
          const active = tab === t.id;
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
        description={`This permanently removes "${service.name}", including its deployment target and all of its configuration. This can't be undone.`}
        okButton={{
          label: "Delete service",
          onClick: async () => {
            await project.deleteDeploymentService(service.id);
            props.onDeleted();
          },
        }}
        cancelButton
      />
    </div>
  );
}
