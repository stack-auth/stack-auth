"use client";

import { useRouter } from "@/components/router";
import { ActionDialog, Button, Typography } from "@/components/ui";
import { Input } from "@/components/ui/input";
import { DashboardSandboxHost } from "@/components/commands/create-dashboard/dashboard-sandbox-host";
import {
  AssistantChat,
  createDashboardChatAdapter,
  createHistoryAdapter,
  DashboardToolUI,
} from "@/components/vibe-coding";
import { ToolCallContent } from "@/components/vibe-coding/chat-adapters";
import { useUpdateConfig } from "@/lib/config-update";
import { cn } from "@/lib/utils";
import {
  PencilSimpleIcon,
  TrashIcon,
  XIcon,
} from "@phosphor-icons/react";
import { throwErr } from "@stackframe/stack-shared/dist/utils/errors";
import { runAsynchronouslyWithAlert } from "@stackframe/stack-shared/dist/utils/promises";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { PageLayout } from "../../page-layout";
import { useAdminApp, useProjectId } from "../../use-admin-app";

function useDashboardId(): string {
  const pathname = usePathname();
  const parts = pathname.split("/");
  const dashboardsIdx = parts.indexOf("dashboards");
  return parts[dashboardsIdx + 1] ?? throwErr("Dashboard ID not found in path");
}

export default function PageClient() {
  const adminApp = useAdminApp();
  const project = adminApp.useProject();
  const projectId = useProjectId();
  const config = project.useConfig();
  const updateConfig = useUpdateConfig();
  const router = useRouter();
  const dashboardId = useDashboardId();

  const dashboard = config.customDashboards[dashboardId];

  useEffect(() => {
    if (!dashboard) {
      router.replace(`/projects/${projectId}/dashboards`);
    }
  }, [dashboard, router, projectId]);

  if (!dashboard) {
    return null;
  }

  return (
    <DashboardDetailContent
      dashboardId={dashboardId}
      displayName={dashboard.displayName}
      tsxSource={dashboard.tsxSource}
      projectId={projectId}
      adminApp={adminApp}
      updateConfig={updateConfig}
      router={router}
    />
  );
}

function DashboardDetailContent({
  dashboardId,
  displayName,
  tsxSource,
  projectId,
  adminApp,
  updateConfig,
  router,
}: {
  dashboardId: string,
  displayName: string,
  tsxSource: string,
  projectId: string,
  adminApp: ReturnType<typeof useAdminApp>,
  updateConfig: ReturnType<typeof useUpdateConfig>,
  router: ReturnType<typeof useRouter>,
}) {
  const hasSource = tsxSource.length > 0;
  const [isChatOpen, setIsChatOpen] = useState(!hasSource);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [currentTsxSource, setCurrentTsxSource] = useState(tsxSource);

  const [isEditingName, setIsEditingName] = useState(false);
  const [editedName, setEditedName] = useState(displayName);

  const artifact = useMemo(() => ({
    prompt: displayName,
    projectId,
    runtimeCodegen: {
      title: displayName,
      description: "",
      uiRuntimeSourceCode: currentTsxSource,
    },
  }), [displayName, projectId, currentTsxSource]);

  const handleBack = useCallback(() => {
    router.push(`/projects/${projectId}/dashboards`);
  }, [router, projectId]);

  const handleEditToggle = useCallback(() => {
    setIsChatOpen(prev => !prev);
  }, []);

  const handleNavigate = useCallback((path: string) => {
    router.push(`/projects/${projectId}${path}`);
  }, [router, projectId]);

  const handleCodeUpdate = useCallback((toolCall: ToolCallContent) => {
    const newCode = toolCall.args.content;
    setCurrentTsxSource(newCode);
    runAsynchronouslyWithAlert(async () => {
      await updateConfig({
        adminApp,
        configUpdate: {
          [`customDashboards.${dashboardId}.tsxSource`]: newCode,
        },
        pushable: false,
      });
    });
  }, [updateConfig, adminApp, dashboardId]);

  const handleSaveName = async () => {
    const trimmed = editedName.trim();
    if (!trimmed || trimmed === displayName) {
      setEditedName(displayName);
      setIsEditingName(false);
      return;
    }
    await updateConfig({
      adminApp,
      configUpdate: {
        [`customDashboards.${dashboardId}.displayName`]: trimmed,
      },
      pushable: false,
    });
    setIsEditingName(false);
  };

  const handleDelete = async () => {
    await updateConfig({
      adminApp,
      configUpdate: {
        [`customDashboards.${dashboardId}`]: null,
      },
      pushable: false,
    });
    router.replace(`/projects/${projectId}/dashboards`);
  };

  const currentHasSource = currentTsxSource.length > 0;

  const dashboardPreview = currentHasSource ? (
    <DashboardSandboxHost
      artifact={artifact}
      onBack={handleBack}
      onEditToggle={handleEditToggle}
      onNavigate={handleNavigate}
      isChatOpen={isChatOpen}
    />
  ) : (
    <div className="flex h-full items-center justify-center">
      <div className="text-center space-y-3">
        <div className="mx-auto h-12 w-12 rounded-2xl bg-foreground/[0.04] ring-1 ring-foreground/[0.06] flex items-center justify-center">
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 256 256" className="text-muted-foreground/60" fill="currentColor">
            <path d="M224,48H32A16,16,0,0,0,16,64V192a16,16,0,0,0,16,16H224a16,16,0,0,0,16-16V64A16,16,0,0,0,224,48ZM32,192V64H224V192ZM48,136a8,8,0,0,1,8-8H200a8,8,0,0,1,0,16H56A8,8,0,0,1,48,136Zm0-32a8,8,0,0,1,8-8h72a8,8,0,0,1,0,16H56A8,8,0,0,1,48,104Zm0,64a8,8,0,0,1,8-8H200a8,8,0,0,1,0,16H56A8,8,0,0,1,48,168Z"/>
          </svg>
        </div>
        <Typography className="font-semibold text-foreground">No dashboard yet</Typography>
        <Typography variant="secondary" className="text-sm max-w-[240px]">
          Describe what you&apos;d like to see in the chat to generate your dashboard.
        </Typography>
      </div>
    </div>
  );

  return (
    <PageLayout fillWidth noPadding>
      {/* Both panels are always in the DOM so the iframe never unmounts/reloads.
          The chat panel animates its width; the dashboard panel adjusts via flex-1. */}
      <div {...(isChatOpen ? { "data-full-bleed": true } : {})} className="flex h-full">
        {/* Dashboard iframe panel */}
        <div className={cn(
          "flex-1 min-w-0 flex flex-col transition-all duration-300 ease-in-out",
          isChatOpen ? "pl-6 pr-2 py-6" : "",
        )}>
          <div className={cn(
            "flex-1 overflow-hidden transition-all duration-300 ease-in-out",
            isChatOpen ? "rounded-2xl shadow-xl ring-1 ring-foreground/[0.06] dark:bg-background/40 backdrop-blur-xl bg-slate-50/90" : "",
          )}>
            {dashboardPreview}
          </div>
        </div>

        {/* Chat panel — slides in from the right. min-w on the inner card prevents content
            squishing during the width animation (overflow-hidden clips the excess). */}
        <div className={cn(
          "shrink-0 flex flex-col overflow-hidden transition-all duration-300 ease-in-out",
          isChatOpen ? "w-[480px] pr-6 pl-2 py-6" : "w-0",
        )}>
          <div className="w-full min-w-[448px] flex-1 overflow-hidden rounded-2xl shadow-xl ring-1 ring-foreground/[0.06] dark:bg-background/40 backdrop-blur-xl bg-slate-50/90">
            <div className="flex flex-col h-full">
              <ChatPanelHeader
                displayName={displayName}
                isEditingName={isEditingName}
                editedName={editedName}
                onStartEditName={() => {
                  setEditedName(displayName);
                  setIsEditingName(true);
                }}
                onEditedNameChange={setEditedName}
                onSaveName={handleSaveName}
                onCancelEditName={() => {
                  setEditedName(displayName);
                  setIsEditingName(false);
                }}
                onDelete={() => setDeleteDialogOpen(true)}
                onClose={() => setIsChatOpen(false)}
              />
              <div className="flex-1 min-h-0">
                <AssistantChat
                  chatAdapter={createDashboardChatAdapter(currentTsxSource, handleCodeUpdate)}
                  historyAdapter={createHistoryAdapter(adminApp, dashboardId)}
                  toolComponents={<DashboardToolUI setCurrentCode={setCurrentTsxSource} />}
                  useOffWhiteLightMode
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      <ActionDialog
        open={deleteDialogOpen}
        onClose={() => setDeleteDialogOpen(false)}
        title="Delete Dashboard"
        okButton={{
          label: "Delete",
          onClick: handleDelete,
          props: { variant: "destructive" },
        }}
        cancelButton={{ label: "Cancel" }}
      >
        <Typography variant="secondary" className="text-sm">
          Are you sure you want to delete &quot;{displayName}&quot;? This action cannot be undone.
        </Typography>
      </ActionDialog>
    </PageLayout>
  );
}

function ChatPanelHeader({
  displayName,
  isEditingName,
  editedName,
  onStartEditName,
  onEditedNameChange,
  onSaveName,
  onCancelEditName,
  onDelete,
  onClose,
}: {
  displayName: string,
  isEditingName: boolean,
  editedName: string,
  onStartEditName: () => void,
  onEditedNameChange: (name: string) => void,
  onSaveName: () => Promise<void>,
  onCancelEditName: () => void,
  onDelete: () => void,
  onClose: () => void,
}) {
  return (
    <div className="flex items-center gap-2 px-4 py-3 border-b border-border/30 dark:border-foreground/[0.06] shrink-0">
      <div className="flex items-center gap-2 min-w-0 flex-1">
        {isEditingName ? (
          <Input
            value={editedName}
            onChange={(e) => onEditedNameChange(e.target.value)}
            className="h-7 text-sm flex-1"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                runAsynchronouslyWithAlert(onSaveName);
              }
              if (e.key === "Escape") {
                onCancelEditName();
              }
            }}
            onBlur={() => runAsynchronouslyWithAlert(onSaveName)}
          />
        ) : (
          <button
            onClick={onStartEditName}
            className="flex items-center gap-1.5 group min-w-0"
          >
            <span className={cn(
              "text-sm font-semibold text-foreground truncate",
            )}>
              {displayName}
            </span>
            <PencilSimpleIcon className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity hover:transition-none shrink-0" />
          </button>
        )}
      </div>

      <div className="flex items-center gap-1 shrink-0">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-red-500 hover:text-red-600 hover:bg-red-500/10"
          onClick={onDelete}
        >
          <TrashIcon className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground hover:text-foreground"
          onClick={onClose}
        >
          <XIcon className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
