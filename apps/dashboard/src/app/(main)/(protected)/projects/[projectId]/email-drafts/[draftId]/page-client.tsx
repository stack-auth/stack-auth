"use client";

import { TeamMemberSearchTable } from "@/components/data-table/team-member-search-table";
import { DesignBadge, DesignBadgeColor } from "@/components/design-components/badge";
import { DesignButton } from "@/components/design-components/button";
import { DesignCard } from "@/components/design-components/card";
import { DesignDataTable } from "@/components/design-components/table";
import EmailPreview, { type OnWysiwygEditCommit } from "@/components/email-preview";
import { EmailThemeSelector } from "@/components/email-theme-selector";
import { useRouter, useRouterConfirm } from "@/components/router";
import { TemplateVariablesButton, TemplateVariablesDialog } from "@/components/template-variables";
import { ActionDialog, Alert, AlertDescription, AlertTitle, Badge, Button, Input, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Skeleton, Spinner, Typography } from "@/components/ui";
import { AssistantChat, CodeEditor, VibeCodeLayout, type ViewportMode, type WysiwygDebugInfo } from "@/components/vibe-coding";
import { ToolCallContent, createChatAdapter, createHistoryAdapter } from "@/components/vibe-coding/chat-adapters";
import { EmailDraftUI } from "@/components/vibe-coding/draft-tool-components";
import { PauseIcon, PlayIcon, XCircleIcon } from "@phosphor-icons/react";
import { AdminEmailOutbox, AdminEmailOutboxStatus, type TemplateVariableInfo } from "@stackframe/stack";
import { KnownErrors } from "@stackframe/stack-shared/dist/known-errors";
import { runAsynchronouslyWithAlert } from "@stackframe/stack-shared/dist/utils/promises";
import { ColumnDef } from "@tanstack/react-table";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppEnabledGuard } from "../../app-enabled-guard";
import { useAdminApp } from "../../use-admin-app";
import { SentEmailsView } from "../../email-sent/sent-emails-view";
import { DraftFlowProvider, useDraftFlow } from "./draft-flow-context";
import { DRAFT_STEPS, DraftProgressBar } from "./draft-progress-bar";

type DraftStage = "draft" | "recipients" | "schedule" | "sent";

const VALID_STAGES: DraftStage[] = ["draft", "recipients", "schedule", "sent"];

function isValidStage(stage: string | null): stage is DraftStage {
  return stage !== null && VALID_STAGES.includes(stage as DraftStage);
}

export default function PageClient({ draftId }: { draftId: string }) {
  const stackAdminApp = useAdminApp();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { setNeedConfirm } = useRouterConfirm();
  const [saveAlert, setSaveAlert] = useState<{
    variant: "destructive" | "success",
    title: string,
    description?: string,
  } | null>(null);

  const drafts = stackAdminApp.useEmailDrafts();
  const draft = useMemo(() => drafts.find((d) => d.id === draftId), [drafts, draftId]);

  // Determine initial stage from URL or draft state
  const initialStage = useMemo((): DraftStage => {
    const urlStage = searchParams.get("stage");
    if (isValidStage(urlStage)) {
      return urlStage;
    }
    // If draft has been sent, default to sent stage
    if (draft?.sentAt) {
      return "sent";
    }
    return "draft";
  }, [searchParams, draft?.sentAt]);

  const [currentCode, setCurrentCode] = useState<string>(draft?.tsxSource ?? "");
  const [stage, setStageInternal] = useState<DraftStage>(initialStage);
  const [selectedThemeId, setSelectedThemeId] = useState<string | undefined | false>(draft?.themeId);
  const [editedVariables, setEditedVariables] = useState<Record<string, string>>(() => {
    const vars = draft?.templateVariables ?? {};
    return Object.fromEntries(Object.entries(vars).map(([k, v]) => [k, String(v)]));
  });
  const [variablesDialogOpen, setVariablesDialogOpen] = useState(false);
  const [viewport, setViewport] = useState<ViewportMode>('edit');
  const [wysiwygDebugInfo, setWysiwygDebugInfo] = useState<WysiwygDebugInfo | undefined>(undefined);

  const hasTemplateVariables = Object.keys(editedVariables).length > 0;

  const [variableMetadata, setVariableMetadata] = useState<TemplateVariableInfo[]>([]);

  useEffect(() => {
    if (!draft?.tsxSource) return;
    let cancelled = false;
    runAsynchronouslyWithAlert(async () => {
      const vars = await stackAdminApp.extractTemplateVariables(draft.tsxSource);
      if (!cancelled) setVariableMetadata(vars);
    });
    return () => {
      cancelled = true;
    };
  }, [draft?.tsxSource, stackAdminApp]);

  const variableTypes = useMemo(() => {
    const types = new Map<string, string>();
    for (const v of variableMetadata) {
      types.set(v.name, v.type);
    }
    return types;
  }, [variableMetadata]);

  const coercedVariables = useMemo((): Record<string, string | number> => {
    const result: Record<string, string | number> = {};
    for (const [k, v] of Object.entries(editedVariables)) {
      if (variableTypes.get(k) === "number") {
        const n = Number(v);
        result[k] = Number.isNaN(n) ? v : n;
      } else {
        result[k] = v;
      }
    }
    return result;
  }, [editedVariables, variableTypes]);

  // Wrapper to update stage and URL together
  // Uses window.history.replaceState directly to avoid triggering the router's confirmation dialog
  // since this is internal navigation within the same page, not actual route navigation
  const setStage = useCallback((newStage: DraftStage) => {
    setStageInternal(newStage);
    const url = new URL(window.location.href);
    url.searchParams.set("stage", newStage);
    window.history.replaceState(null, "", url.pathname + url.search);
  }, []);

  useEffect(() => {
    if (!draft) return;
    if (draft.tsxSource === currentCode && draft.themeId === selectedThemeId) return;
    if (stage !== "draft") return;

    setNeedConfirm(true);
    return () => setNeedConfirm(false);
  }, [setNeedConfirm, draft, currentCode, selectedThemeId, stage]);

  const handleToolUpdate = (toolCall: ToolCallContent) => {
    setCurrentCode(toolCall.args.content);
  };

  const handleSave = async () => {
    setSaveAlert(null);
    try {
      await stackAdminApp.updateEmailDraft(draftId, {
        tsxSource: currentCode,
        themeId: selectedThemeId,
        ...(hasTemplateVariables ? { templateVariables: coercedVariables } : {}),
      });
      setSaveAlert({ variant: "success", title: "Draft saved" });
    } catch (error) {
      if (error instanceof KnownErrors.EmailRenderingError) {
        setSaveAlert({
          variant: "destructive",
          title: "Failed to save draft",
          description: error.message,
        });
        return;
      }
      throw error;
    }
  };

  const handleNext = async () => {
    setSaveAlert(null);

    if (hasTemplateVariables) {
      const emptyVars = Object.entries(editedVariables).filter(([, v]) => !v.trim());
      if (emptyVars.length > 0) {
        setSaveAlert({
          variant: "destructive",
          title: "Missing template variables",
          description: `Please fill in: ${emptyVars.map(([k]) => k).join(", ")}`,
        });
        setVariablesDialogOpen(true);
        return;
      }
    }

    try {
      await stackAdminApp.updateEmailDraft(draftId, {
        tsxSource: currentCode,
        themeId: selectedThemeId,
        ...(hasTemplateVariables ? { templateVariables: coercedVariables } : {}),
      });
      setNeedConfirm(false);
      setStage("recipients");
    } catch (error) {
      if (error instanceof KnownErrors.EmailRenderingError) {
        setSaveAlert({
          variant: "destructive",
          title: "Failed to save draft",
          description: error.message,
        });
        return;
      }
      throw error;
    }
  };

  const handleUndo = () => {
    if (draft) {
      setCurrentCode(draft.tsxSource);
      setSelectedThemeId(draft.themeId);
      setEditedVariables(Object.fromEntries(Object.entries(draft.templateVariables).map(([k, v]) => [k, String(v)])));
    }
  };

  const previewActions = null;
  const variablesDirty = hasTemplateVariables && draft ? JSON.stringify(coercedVariables) !== JSON.stringify(draft.templateVariables) : false;
  const isDirty = draft ? (currentCode !== draft.tsxSource || selectedThemeId !== draft.themeId || variablesDirty) : false;

  // Handle WYSIWYG edit commits - calls the AI endpoint to update source code
  const handleWysiwygEditCommit: OnWysiwygEditCommit = useCallback(async (data) => {
    const result = await stackAdminApp.applyWysiwygEdit({
      sourceType: 'draft',
      sourceCode: currentCode,
      oldText: data.oldText,
      newText: data.newText,
      metadata: data.metadata,
      domPath: data.domPath,
      htmlContext: data.htmlContext,
    });
    setCurrentCode(result.updatedSource);
    return result.updatedSource;
  }, [stackAdminApp, currentCode]);

  return (
    <AppEnabledGuard appId="emails">
      <DraftFlowProvider>
        {stage === "draft" ? (
          <div data-full-bleed className="flex h-full flex-col">
            <div>
              <DraftProgressBar
                steps={DRAFT_STEPS}
                currentStep={stage}
                onStepClick={setStage as (stepId: string) => void}
              />
            </div>
            {saveAlert && (
              <div className="px-3 pt-3 md:px-6 md:pt-4">
                <Alert variant={saveAlert.variant}>
                  <AlertTitle>{saveAlert.title}</AlertTitle>
                  {saveAlert.description && (
                    <AlertDescription>{saveAlert.description}</AlertDescription>
                  )}
                </Alert>
              </div>
            )}
            <div className="flex-1 min-h-0">
              <VibeCodeLayout
                viewport={viewport}
                onViewportChange={setViewport}
                useOffWhiteLightChrome
                onSave={handleSave}
                saveLabel="Save draft"
                onUndo={handleUndo}
                isDirty={isDirty}
                previewActions={previewActions}
                editorTitle="Draft Source Code"
                editModeEnabled
                codeToggleBarExtra={hasTemplateVariables ? (
                  <TemplateVariablesButton
                    isDirty={variablesDirty}
                    onClick={() => setVariablesDialogOpen(true)}
                  />
                ) : null}
                wysiwygDebugInfo={wysiwygDebugInfo}
                headerAction={
                  <EmailThemeSelector
                    selectedThemeId={selectedThemeId}
                    onThemeChange={setSelectedThemeId}
                  />
                }
                primaryAction={{
                  label: "Next: Recipients",
                  onClick: handleNext,
                }}
                previewComponent={
                  <EmailPreview
                    themeId={selectedThemeId}
                    templateTsxSource={currentCode}
                    editMode={viewport === 'edit'}
                    viewport={viewport === 'desktop' || viewport === 'edit' ? undefined : (viewport === 'tablet' ? { id: 'tablet', name: 'Tablet', width: 820, height: 1180, type: 'tablet' } : { id: 'phone', name: 'Phone', width: 390, height: 844, type: 'phone' })}
                    emailSubject={draft?.displayName}
                    onDebugInfoChange={setWysiwygDebugInfo}
                    onWysiwygEditCommit={handleWysiwygEditCommit}
                  />
                }
                editorComponent={
                  <CodeEditor
                    code={currentCode}
                    onCodeChange={setCurrentCode}
                  />
                }
                chatComponent={
                  <AssistantChat
                    historyAdapter={createHistoryAdapter(stackAdminApp, draftId)}
                    chatAdapter={createChatAdapter(stackAdminApp, draftId, "email-draft", handleToolUpdate)}
                    toolComponents={<EmailDraftUI setCurrentCode={setCurrentCode} />}
                    useOffWhiteLightMode
                  />
                }
              />
            </div>
          </div>
        ) : stage === "recipients" ? (
          <RecipientsStage
            draftId={draftId}
            onBack={() => setStage("draft")}
            onNext={() => setStage("schedule")}
            onStepClick={setStage as (stepId: string) => void}
          />
        ) : stage === "schedule" ? (
          <ScheduleStage
            draftId={draftId}
            onBack={() => setStage("recipients")}
            onSent={() => setStage("sent")}
            onStepClick={setStage as (stepId: string) => void}
          />
        ) : (
          <SentStage draftId={draftId} />
        )}

        <TemplateVariablesDialog
          open={variablesDialogOpen}
          onOpenChange={setVariablesDialogOpen}
          variables={editedVariables}
          onVariablesChange={setEditedVariables}
          isDirty={variablesDirty}
        />
      </DraftFlowProvider>
    </AppEnabledGuard>
  );
}

type RecipientsStageProps = {
  draftId: string,
  onBack: () => void,
  onNext: () => void,
  onStepClick: (stepId: string) => void,
};

function RecipientsStage({ draftId, onBack, onNext, onStepClick }: RecipientsStageProps) {
  const { flowState, updateRecipients } = useDraftFlow();
  const { scope, selectedUsers } = flowState.recipients;

  const selectedUserIds = useMemo(() => selectedUsers.map(u => u.id), [selectedUsers]);

  const handleScopeChange = (newScope: "all" | "users") => {
    updateRecipients({ scope: newScope });
  };

  const handleToggleUser = (user: { id: string, displayName: string | null, primaryEmail: string | null }) => {
    const isSelected = selectedUsers.some(u => u.id === user.id);
    const newUsers = isSelected
      ? selectedUsers.filter((u) => u.id !== user.id)
      : [...selectedUsers, { id: user.id, displayName: user.displayName, primaryEmail: user.primaryEmail }];
    updateRecipients({ selectedUsers: newUsers });
  };

  const handleRemoveUser = (userId: string) => {
    updateRecipients({ selectedUsers: selectedUsers.filter(u => u.id !== userId) });
  };

  const handleClearSelection = () => {
    updateRecipients({ selectedUsers: [] });
  };

  const canProceed = scope === "all" || selectedUsers.length > 0;

  const getUserDisplayLabel = (user: { displayName: string | null, primaryEmail: string | null }) => {
    if (user.displayName) return user.displayName;
    if (user.primaryEmail) return user.primaryEmail;
    return "Unknown user";
  };

  return (
    <div className="mx-auto w-full max-w-4xl p-4">
      <DraftProgressBar steps={DRAFT_STEPS} currentStep="recipients" onStepClick={onStepClick} />

      <DesignCard glassmorphic gradient="default" className="mt-4">
        <div className="flex flex-col gap-6">
          {/* Recipients Section */}
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <Typography className="font-medium text-lg">Choose Recipients</Typography>
              {scope === "users" && (
                <div className="flex items-center gap-2">
                  <Badge variant="secondary">{selectedUsers.length} selected</Badge>
                  {selectedUsers.length > 0 && (
                    <Button type="button" size="sm" variant="ghost" onClick={handleClearSelection}>Clear</Button>
                  )}
                </div>
              )}
            </div>
            <div className="max-w-sm">
              <Select value={scope} onValueChange={(v) => handleScopeChange(v as "all" | "users")}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose recipients" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All users</SelectItem>
                  <SelectItem value="users">Select users…</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {scope === "users" && (
              <div className="mt-2 flex flex-col gap-4">
                {/* Selected Users Section */}
                {selectedUsers.length > 0 && (
                  <div className="flex flex-col gap-2 p-3 bg-muted/30 rounded-lg">
                    <Typography variant="secondary" className="text-xs font-medium uppercase tracking-wider">
                      Selected Users ({selectedUsers.length})
                    </Typography>
                    <div className="flex flex-wrap gap-2">
                      {selectedUsers.map((user) => (
                        <Badge
                          key={user.id}
                          variant="secondary"
                          className="flex items-center gap-1 pr-1"
                        >
                          <span className="text-xs max-w-[150px] truncate">{getUserDisplayLabel(user)}</span>
                          <button
                            type="button"
                            onClick={() => handleRemoveUser(user.id)}
                            className="ml-1 h-4 w-4 rounded-full hover:bg-muted flex items-center justify-center"
                          >
                            <span className="text-xs">×</span>
                          </button>
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}

                {/* Search Table */}
                <TeamMemberSearchTable
                  action={(user) => (
                    <Button
                      type="button"
                      size="sm"
                      variant={selectedUserIds.includes(user.id) ? "default" : "outline"}
                      onClick={() => handleToggleUser(user)}
                    >
                      {selectedUserIds.includes(user.id) ? "Selected" : "Add"}
                    </Button>
                  )}
                />
              </div>
            )}
          </div>

          {/* Action Buttons */}
          <div className="flex justify-between border-t border-black/[0.12] dark:border-white/[0.06] pt-6">
            <Button type="button" variant="outline" onClick={onBack}>
              Back
            </Button>
            <Button type="button" disabled={!canProceed} onClick={onNext}>
              Next: Schedule
            </Button>
          </div>
        </div>
      </DesignCard>
    </div>
  );
}

type ScheduleStageProps = {
  draftId: string,
  onBack: () => void,
  onSent: () => void,
  onStepClick: (stepId: string) => void,
};

function ScheduleStage({ draftId, onBack, onSent, onStepClick }: ScheduleStageProps) {
  const stackAdminApp = useAdminApp();
  const { flowState, updateSchedule, resetFlowState } = useDraftFlow();
  const { scope, selectedUsers } = flowState.recipients;
  const { mode: scheduleMode, date: scheduledDate, time: scheduledTime } = flowState.schedule;

  const selectedUserIds = useMemo(() => selectedUsers.map(u => u.id), [selectedUsers]);

  const [sendAlert, setSendAlert] = useState<{
    variant: "destructive" | "success",
    title: string,
    description?: string,
  } | null>(null);

  const handleScheduleModeChange = (newMode: "immediate" | "scheduled") => {
    updateSchedule({ mode: newMode });
  };

  const handleDateChange = (newDate: string) => {
    updateSchedule({ date: newDate });
  };

  const handleTimeChange = (newTime: string) => {
    updateSchedule({ time: newTime });
  };

  const handleSubmit = async () => {
    setSendAlert(null);
    try {
      const scheduledAt = scheduleMode === "scheduled" && scheduledDate && scheduledTime
        ? new Date(`${scheduledDate}T${scheduledTime}`)
        : undefined;

      await stackAdminApp.sendEmail(
        (scope === "users"
          ? { draftId, userIds: selectedUserIds, scheduledAt }
          : { draftId, allUsers: true, scheduledAt }
        ) as Parameters<typeof stackAdminApp.sendEmail>[0]
      );

      await stackAdminApp.refreshEmailDrafts();
      resetFlowState();
      onSent();
    } catch (error) {
      if (error instanceof KnownErrors.EmailRenderingError || error instanceof KnownErrors.RequiresCustomEmailServer) {
        setSendAlert({
          variant: "destructive",
          title: "Failed to send email",
          description: error.message,
        });
        return;
      }
      throw error;
    }
  };

  const canSend = scheduleMode === "immediate" || (scheduledDate && scheduledTime);

  return (
    <div className="mx-auto w-full max-w-4xl p-4">
      <DraftProgressBar steps={DRAFT_STEPS} currentStep="schedule" onStepClick={onStepClick} />

      {sendAlert && (
        <div className="my-4">
          <Alert variant={sendAlert.variant}>
            <AlertTitle>{sendAlert.title}</AlertTitle>
            {sendAlert.description && (
              <AlertDescription>{sendAlert.description}</AlertDescription>
            )}
          </Alert>
        </div>
      )}

      <DesignCard glassmorphic gradient="default" className="mt-4">
        <div className="flex flex-col gap-6">
          {/* Summary of recipients */}
          <div className="flex flex-col gap-2 pb-4 border-b border-black/[0.12] dark:border-white/[0.06]">
            <Typography variant="secondary" className="text-sm">
              Sending to: {scope === "all" ? "All users" : `${selectedUsers.length} selected user${selectedUsers.length !== 1 ? "s" : ""}`}
            </Typography>
          </div>

          {/* Scheduling Section */}
          <div className="flex flex-col gap-4">
            <Typography className="font-medium text-lg">Schedule Sending</Typography>
            <div className="max-w-sm">
              <Select value={scheduleMode} onValueChange={(v) => handleScheduleModeChange(v as "immediate" | "scheduled")}>
                <SelectTrigger>
                  <SelectValue placeholder="When to send" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="immediate">Send immediately</SelectItem>
                  <SelectItem value="scheduled">Schedule for later</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {scheduleMode === "scheduled" && (
              <div className="flex flex-col gap-3 mt-2">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="schedule-date">Date</Label>
                  <Input
                    id="schedule-date"
                    type="date"
                    value={scheduledDate}
                    onChange={(e) => handleDateChange(e.target.value)}
                    className="max-w-[200px]"
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="schedule-time">Time</Label>
                  <Input
                    id="schedule-time"
                    type="time"
                    value={scheduledTime}
                    onChange={(e) => handleTimeChange(e.target.value)}
                    className="max-w-[200px]"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Action Buttons */}
          <div className="flex justify-between border-t border-black/[0.12] dark:border-white/[0.06] pt-6">
            <Button variant="outline" onClick={onBack}>
              Back
            </Button>
            <Button disabled={!canSend} onClick={handleSubmit}>
              {scheduleMode === "scheduled" ? "Schedule" : "Send"}
            </Button>
          </div>
        </div>
      </DesignCard>
    </div>
  );
}

function getErrorMessage(error: unknown) {
  if (error instanceof KnownErrors.EmailRenderingError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "Unknown error";
}


const PAUSABLE_STATUSES: Set<AdminEmailOutboxStatus> = new Set([
  "preparing", "rendering", "scheduled", "queued", "render-error", "server-error",
]);

const CANCELLABLE_STATUSES: Set<AdminEmailOutboxStatus> = new Set([
  "paused", "preparing", "rendering", "scheduled", "queued", "render-error", "server-error",
]);

function SentStage({ draftId }: { draftId: string }) {
  const stackAdminApp = useAdminApp();
  const filterFn = useCallback((email: AdminEmailOutbox) => email.emailDraftId === draftId, [draftId]);
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [cancelContext, setCancelContext] = useState<{ count: number, emails: AdminEmailOutbox[], refresh: () => Promise<void> } | null>(null);

  const renderActions = useCallback((emails: AdminEmailOutbox[], refresh: () => Promise<void>) => {
    const pausable = emails.filter(e => PAUSABLE_STATUSES.has(e.status) && !e.isPaused);
    const paused = emails.filter(e => e.isPaused);
    const cancellable = emails.filter(e => CANCELLABLE_STATUSES.has(e.status));
    const delivered = emails.filter(e => !CANCELLABLE_STATUSES.has(e.status) && e.status !== "skipped");
    const cancelled = emails.filter(e => e.status === "skipped");
    const unchangeable = delivered.length + cancelled.length;

    if (pausable.length === 0 && paused.length === 0 && cancellable.length === 0 && unchangeable === 0) return null;

    return (
      <div className="flex flex-col gap-3">
        {unchangeable > 0 && (
          <Alert variant="default" className="bg-amber-500/5 border-amber-500/20">
            <AlertTitle className="text-amber-600 dark:text-amber-400">
              {unchangeable} of {emails.length} email{emails.length !== 1 ? "s" : ""} already {delivered.length > 0 && cancelled.length > 0 ? "delivered or cancelled" : delivered.length > 0 ? "delivered" : "cancelled"}
            </AlertTitle>
            <AlertDescription className="text-muted-foreground">
              Emails that have already been delivered or cancelled cannot be paused or cancelled.
            </AlertDescription>
          </Alert>
        )}

        {(pausable.length > 0 || paused.length > 0 || cancellable.length > 0) && (
          <div className="flex gap-2">
            {pausable.length > 0 && (
              <DesignButton
                variant="outline"
                size="sm"
                className="hover:bg-accent"
                onClick={async () => {
                  await Promise.allSettled(pausable.map(e => stackAdminApp.pauseOutboxEmail(e.id)));
                  await refresh();
                }}
              >
                <PauseIcon className="mr-1.5 h-3.5 w-3.5" />
                Pause {pausable.length} email{pausable.length !== 1 ? "s" : ""}
              </DesignButton>
            )}
            {paused.length > 0 && (
              <DesignButton
                variant="outline"
                size="sm"
                className="hover:bg-accent"
                onClick={async () => {
                  await Promise.allSettled(paused.map(e => stackAdminApp.unpauseOutboxEmail(e.id)));
                  await refresh();
                }}
              >
                <PlayIcon className="mr-1.5 h-3.5 w-3.5" />
                Resume {paused.length} email{paused.length !== 1 ? "s" : ""}
              </DesignButton>
            )}
            {cancellable.length > 0 && (
              <DesignButton
                variant="destructive"
                size="sm"
                onClick={() => {
                  setCancelContext({ count: cancellable.length, emails: cancellable, refresh });
                  setCancelDialogOpen(true);
                }}
              >
                <XCircleIcon className="mr-1.5 h-3.5 w-3.5" />
                Cancel {cancellable.length} email{cancellable.length !== 1 ? "s" : ""}
              </DesignButton>
            )}
          </div>
        )}
      </div>
    );
  }, [stackAdminApp]);

  return (
    <div className="mx-auto w-full max-w-6xl p-4">
      <DraftProgressBar steps={DRAFT_STEPS} currentStep="sent" disableNavigation />
      <div className="mt-4">
        <SentEmailsView filterFn={filterFn} renderActions={renderActions} />
      </div>

      <ActionDialog
        open={cancelDialogOpen}
        onClose={() => setCancelDialogOpen(false)}
        title="Cancel Emails"
        cancelButton
        okButton={{
          label: `Cancel ${cancelContext?.count ?? 0} email${(cancelContext?.count ?? 0) !== 1 ? "s" : ""}`,
          onClick: async () => {
            if (!cancelContext) return;
            await Promise.allSettled(cancelContext.emails.map(e => stackAdminApp.cancelOutboxEmail(e.id)));
            setCancelDialogOpen(false);
            await cancelContext.refresh();
          },
          props: { variant: "destructive" },
        }}
      >
        <Typography>
          This will cancel {cancelContext?.count ?? 0} email{(cancelContext?.count ?? 0) !== 1 ? "s" : ""} that {(cancelContext?.count ?? 0) !== 1 ? "haven't" : "hasn't"} been sent yet. This action cannot be undone.
        </Typography>
      </ActionDialog>
    </div>
  );
}
