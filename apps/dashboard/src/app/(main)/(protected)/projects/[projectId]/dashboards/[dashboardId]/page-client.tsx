"use client";

import { DashboardSandboxHost } from "@/components/commands/create-dashboard/dashboard-sandbox-host";
import { useRouter, useRouterConfirm } from "@/components/router";
import { ActionDialog, Button, Typography } from "@/components/ui";
import { Input } from "@/components/ui/input";
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
  FloppyDiskIcon,
  PencilSimpleIcon,
  PlusIcon,
  TrashIcon,
  XIcon,
} from "@phosphor-icons/react";
import { ALL_APPS } from "@stackframe/stack-shared/dist/apps/apps-config";
import { typedEntries } from "@stackframe/stack-shared/dist/utils/objects";
import { throwErr } from "@stackframe/stack-shared/dist/utils/errors";
import type { AppId } from "@/lib/apps-frontend";
import { runAsynchronouslyWithAlert } from "@stackframe/stack-shared/dist/utils/promises";
import { getPublicEnvVar } from "@/lib/env";
import { useUser } from "@stackframe/stack";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PageLayout } from "../../page-layout";
import { useAdminApp, useProjectId } from "../../use-admin-app";

const GRID_STATE_PREFIX = "// __GRID_STATE__:";

function extractGridStateFromSource(tsxSource: string): unknown | null {
  const idx = tsxSource.indexOf(GRID_STATE_PREFIX);
  if (idx === -1) return null;
  const lineStart = idx + GRID_STATE_PREFIX.length;
  const lineEnd = tsxSource.indexOf("\n", lineStart);
  const jsonStr = tsxSource.slice(lineStart, lineEnd === -1 ? undefined : lineEnd).trim();
  try {
    return JSON.parse(jsonStr);
  } catch {
    return null;
  }
}

function stripGridStateFromSource(tsxSource: string): string {
  const idx = tsxSource.indexOf(GRID_STATE_PREFIX);
  if (idx === -1) return tsxSource;
  const lineEnd = tsxSource.indexOf("\n", idx);
  if (lineEnd === -1) return tsxSource.slice(0, idx).trimEnd();
  return (tsxSource.slice(0, idx) + tsxSource.slice(lineEnd + 1)).replace(/^\n/, "");
}

function embedGridStateInSource(tsxSource: string, gridState: unknown | null): string {
  if (gridState == null) return tsxSource;
  const clean = stripGridStateFromSource(tsxSource);
  return `${GRID_STATE_PREFIX}${JSON.stringify(gridState)}\n${clean}`;
}

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
  const currentUser = useUser({ or: "redirect" });
  const backendBaseUrl = getPublicEnvVar("NEXT_PUBLIC_STACK_API_URL") ?? "";
  const config = project.useConfig();
  const updateConfig = useUpdateConfig();
  const router = useRouter();
  const dashboardId = useDashboardId();
  const [hasEverExisted, setHasEverExisted] = useState(false);

  const enabledAppIds = useMemo(() =>
    typedEntries(config.apps.installed)
      .filter(([appId, appConfig]) => appConfig?.enabled && appId in ALL_APPS)
      .map(([appId]) => appId as AppId),
    [config.apps.installed]
  );

  const dashboard = config.customDashboards[dashboardId] as
    | typeof config.customDashboards[string]
    | undefined;

  useEffect(() => {
    if (dashboard) {
      setHasEverExisted(true);
    }
  }, [dashboard]);

  useEffect(() => {
    if (hasEverExisted && !dashboard) {
      router.replace(`/projects/${projectId}/dashboards`);
    }
  }, [hasEverExisted, dashboard, router, projectId]);

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
      currentUser={currentUser}
      backendBaseUrl={backendBaseUrl}
      enabledAppIds={enabledAppIds}
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
  currentUser,
  backendBaseUrl,
  enabledAppIds,
}: {
  dashboardId: string,
  displayName: string,
  tsxSource: string,
  projectId: string,
  adminApp: ReturnType<typeof useAdminApp>,
  updateConfig: ReturnType<typeof useUpdateConfig>,
  router: ReturnType<typeof useRouter>,
  currentUser: NonNullable<ReturnType<typeof useUser>>,
  backendBaseUrl: string,
  enabledAppIds: AppId[],
}) {
  const composerPlaceholder = useTypingPlaceholder(
    "Create a dashboard about ",
    DASHBOARD_PLACEHOLDER_SUFFIXES,
  );

  const hasSource = tsxSource.length > 0;
  const [isChatOpen, setIsChatOpen] = useState(!hasSource);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [currentTsxSource, setCurrentTsxSource] = useState(() => stripGridStateFromSource(tsxSource));
  const [savedTsxSource, setSavedTsxSource] = useState(() => stripGridStateFromSource(tsxSource));
  const [gridState, setGridState] = useState<unknown | null>(() => {
    const gs = extractGridStateFromSource(tsxSource);
    console.log('[GridSave] initial gridState from source:', gs ? 'present' : 'null');
    return gs;
  });
  const [savedGridState, setSavedGridState] = useState<unknown | null>(() => extractGridStateFromSource(tsxSource));
  const hasUnsavedChanges = currentTsxSource !== savedTsxSource || JSON.stringify(gridState) !== JSON.stringify(savedGridState);
  const [layoutEditing, setLayoutEditing] = useState(false);
  const [editingWidgetId, setEditingWidgetId] = useState<string | null>(null);
  const [editingWidgetLabel, setEditingWidgetLabel] = useState<string | null>(null);
  const [addingWidgetPosition, setAddingWidgetPosition] = useState<{ x: number, y: number, width: number, height: number } | null>(null);
  const [selectingForEdit, setSelectingForEdit] = useState(false);
  const { setNeedConfirm } = useRouterConfirm();
  useEffect(() => {
    if (!hasUnsavedChanges) return;
    setNeedConfirm(true);
    return () => setNeedConfirm(false);
  }, [setNeedConfirm, hasUnsavedChanges]);

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

  const currentHasSource = currentTsxSource.length > 0;

  const handleEditToggle = useCallback(() => {
    if (!currentHasSource) return;
    setIsChatOpen(prev => {
      if (prev) {
        setLayoutEditing(true);
        setSelectingForEdit(false);
        return false;
      }
      return true;
    });
  }, [currentHasSource]);

  const handleNavigate = useCallback((path: string) => {
    router.push(`/projects/${projectId}${path}`);
  }, [router, projectId]);

  const handleCodeUpdate = useCallback((toolCall: ToolCallContent) => {
    setCurrentTsxSource(toolCall.args.content);
  }, []);

  const handleWidgetEditRequest = useCallback((widgetId: string, widgetLabel: string) => {
    setEditingWidgetId(widgetId);
    setEditingWidgetLabel(widgetLabel);
    setAddingWidgetPosition(null);
    setIsChatOpen(true);
    setLayoutEditing(false);
    setSelectingForEdit(false);
  }, []);

  const handleWidgetAddRequest = useCallback((x: number, y: number, width: number, height: number) => {
    setAddingWidgetPosition({ x, y, width, height });
    setEditingWidgetId(null);
    setEditingWidgetLabel(null);
    setIsChatOpen(true);
  }, []);

  const handleGridStateChange = useCallback((serializedGrid: unknown) => {
    console.log('[GridSave] handleGridStateChange called, serializedGrid:', JSON.stringify(serializedGrid).slice(0, 200));
    setGridState(serializedGrid);
  }, []);

  const handleSaveDashboard = useCallback(async () => {
    const sourceToSave = embedGridStateInSource(currentTsxSource, gridState);
    console.log('[GridSave] saving, gridState is:', gridState ? 'present' : 'null');
    console.log('[GridSave] sourceToSave first 300 chars:', sourceToSave.slice(0, 300));
    await updateConfig({
      adminApp,
      configUpdate: {
        [`customDashboards.${dashboardId}.tsxSource`]: sourceToSave,
      },
      pushable: false,
    });
    setSavedTsxSource(currentTsxSource);
    setSavedGridState(gridState);
    console.log('[GridSave] save complete');
  }, [updateConfig, adminApp, dashboardId, currentTsxSource, gridState]);

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

  const dashboardPreview = currentHasSource ? (
    <DashboardSandboxHost
      artifact={artifact}
      onBack={handleBack}
      onEditToggle={handleEditToggle}
      onNavigate={handleNavigate}
      onWidgetEditRequest={handleWidgetEditRequest}
      onWidgetAddRequest={handleWidgetAddRequest}
      onGridStateChange={handleGridStateChange}
      savedGridState={gridState}
      isChatOpen={isChatOpen}
      layoutEditing={layoutEditing}
      selectingForEdit={selectingForEdit}
      onDoneEditing={() => {
        setLayoutEditing(false);
        setIsChatOpen(true);
      }}
      onAltKeyDown={() => {}}
      onAltKeyUp={() => {}}
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
      <div data-full-bleed className="flex h-full">
        {/* Dashboard iframe panel */}
        <div
          className={cn(
            "flex-1 min-w-0 flex flex-col transition-all duration-300 ease-in-out",
            "pl-6 pr-5 py-6",
            !isChatOpen && "dark:p-0",
          )}
        >
          <div className={cn(
            "relative flex-1 overflow-hidden transition-all duration-300 ease-in-out",
            "dark:bg-transparent dark:rounded-none dark:shadow-none dark:ring-0",
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
                onClose={currentHasSource ? () => setIsChatOpen(false) : undefined}
                hasUnsavedChanges={hasUnsavedChanges}
                onSaveDashboard={handleSaveDashboard}
              />
              <div className="flex-1 min-h-0">
                <AssistantChat
                  chatAdapter={createDashboardChatAdapter(backendBaseUrl, currentTsxSource, handleCodeUpdate, currentUser, editingWidgetId, addingWidgetPosition, enabledAppIds)}
                  historyAdapter={createHistoryAdapter(adminApp, dashboardId)}
                  toolComponents={<DashboardToolUI setCurrentCode={setCurrentTsxSource} />}
                  useOffWhiteLightMode
                  composerPlaceholder={currentHasSource ? undefined : composerPlaceholder}
                  hideMessageActions
                />
              </div>
              {selectingForEdit && (
                <div className="flex items-center gap-2 px-4 py-1.5 bg-primary/5 border-t border-border/30 dark:border-foreground/[0.06] shrink-0">
                  <PencilSimpleIcon className="h-3 w-3 text-primary shrink-0" />
                  <span className="text-xs text-primary truncate flex-1">
                    Choose a component to edit
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-5 w-5 text-primary hover:text-primary/80"
                    onClick={() => setSelectingForEdit(false)}
                  >
                    <XIcon className="h-3 w-3" />
                  </Button>
                </div>
              )}
              {editingWidgetId == null && addingWidgetPosition == null && !selectingForEdit && currentHasSource && (
                <div className="flex items-center gap-2 px-4 py-1.5 border-t border-border/30 dark:border-foreground/[0.06] shrink-0">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 gap-1.5 text-xs text-muted-foreground hover:text-foreground w-full justify-start"
                    onClick={() => {
                      setSelectingForEdit(true);
                    }}
                  >
                    <PencilSimpleIcon className="h-3 w-3" />
                    Edit a component...
                  </Button>
                </div>
              )}
              {editingWidgetId != null && (
                <div className="flex items-center gap-2 px-4 py-1.5 bg-primary/5 border-t border-border/30 dark:border-foreground/[0.06] shrink-0">
                  <PencilSimpleIcon className="h-3 w-3 text-primary shrink-0" />
                  <span className="text-xs text-primary truncate flex-1">
                    Editing: {editingWidgetLabel ?? editingWidgetId}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-5 w-5 text-primary hover:text-primary/80"
                    onClick={() => {
                      setEditingWidgetId(null);
                      setEditingWidgetLabel(null);
                    }}
                  >
                    <XIcon className="h-3 w-3" />
                  </Button>
                </div>
              )}
              {addingWidgetPosition != null && (
                <div className="flex items-center gap-2 px-4 py-1.5 bg-primary/5 border-t border-border/30 dark:border-foreground/[0.06] shrink-0">
                  <PlusIcon className="h-3 w-3 text-primary shrink-0" />
                  <span className="text-xs text-primary truncate flex-1">
                    Adding new widget
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-5 w-5 text-primary hover:text-primary/80"
                    onClick={() => setAddingWidgetPosition(null)}
                  >
                    <XIcon className="h-3 w-3" />
                  </Button>
                </div>
              )}
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

const DASHBOARD_PLACEHOLDER_SUFFIXES = [
  "user signups and retention",
  "team activity across projects",
  "API latency and error rates",
  "email open rates and clicks",
  "authentication trends",
  "revenue and subscription growth",
];

function useTypingPlaceholder(
  prefix: string,
  suffixes: readonly string[],
  { typeSpeed = 70, deleteSpeed = 40, pauseAfterType = 2000, pauseAfterDelete = 400 } = {},
): string {
  const [suffixText, setSuffixText] = useState("");
  const state = useRef({
    suffixIndex: 0,
    charIndex: 0,
    phase: "typing" as "typing" | "pausing" | "deleting" | "waiting",
  });

  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout>;

    function tick() {
      const s = state.current;
      const target = suffixes[s.suffixIndex % suffixes.length];

      switch (s.phase) {
        case "typing": {
          if (s.charIndex < target.length) {
            s.charIndex++;
            setSuffixText(target.slice(0, s.charIndex));
            timeoutId = setTimeout(tick, typeSpeed);
          } else {
            s.phase = "pausing";
            timeoutId = setTimeout(tick, pauseAfterType);
          }
          break;
        }
        case "pausing": {
          s.phase = "deleting";
          timeoutId = setTimeout(tick, deleteSpeed);
          break;
        }
        case "deleting": {
          if (s.charIndex > 0) {
            s.charIndex--;
            setSuffixText(target.slice(0, s.charIndex));
            timeoutId = setTimeout(tick, deleteSpeed);
          } else {
            s.phase = "waiting";
            timeoutId = setTimeout(tick, pauseAfterDelete);
          }
          break;
        }
        case "waiting": {
          s.suffixIndex = (s.suffixIndex + 1) % suffixes.length;
          s.charIndex = 0;
          s.phase = "typing";
          timeoutId = setTimeout(tick, typeSpeed);
          break;
        }
      }
    }

    timeoutId = setTimeout(tick, 500);
    return () => clearTimeout(timeoutId);
  }, [suffixes, typeSpeed, deleteSpeed, pauseAfterType, pauseAfterDelete]);

  return prefix + suffixText;
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
  hasUnsavedChanges,
  onSaveDashboard,
}: {
  displayName: string,
  isEditingName: boolean,
  editedName: string,
  onStartEditName: () => void,
  onEditedNameChange: (name: string) => void,
  onSaveName: () => Promise<void>,
  onCancelEditName: () => void,
  onDelete: () => void,
  onClose?: () => void,
  hasUnsavedChanges: boolean,
  onSaveDashboard: () => Promise<void>,
}) {
  return (
    <div className="flex flex-col shrink-0">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border/30 dark:border-foreground/[0.06]">
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
          {hasUnsavedChanges && (
            <Button
              size="sm"
              className="h-7 gap-1.5 text-xs min-w-[60px]"
              onClick={onSaveDashboard}
            >
              <span className="flex items-center gap-1.5">
                <FloppyDiskIcon className="h-3.5 w-3.5" />
                Save
              </span>
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-red-500 hover:text-red-600 hover:bg-red-500/10"
            onClick={onDelete}
          >
            <TrashIcon className="h-3.5 w-3.5" />
          </Button>
          {onClose && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-foreground"
              onClick={onClose}
            >
              <XIcon className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
