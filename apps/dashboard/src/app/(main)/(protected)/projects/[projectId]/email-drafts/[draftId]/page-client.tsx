"use client";

import { TeamMemberSearchTable } from "@/components/data-table/team-member-search-table";
import { DesignBadge, DesignBadgeColor } from "@/components/design-components/badge";
import { DesignCard } from "@/components/design-components/card";
import { DesignDataTable } from "@/components/design-components/table";
import EmailPreview, { type OnWysiwygEditCommit } from "@/components/email-preview";
import { EmailThemeSelector } from "@/components/email-theme-selector";
import { useRouter, useRouterConfirm } from "@/components/router";
import { Alert, AlertDescription, AlertTitle, Badge, Button, Card, CardContent, Input, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Skeleton, Spinner, Typography } from "@/components/ui";
import { AssistantChat, CodeEditor, VibeCodeLayout, type ViewportMode, type WysiwygDebugInfo } from "@/components/vibe-coding";
import { ToolCallContent, createChatAdapter, createHistoryAdapter } from "@/components/vibe-coding/chat-adapters";
import { EmailDraftUI } from "@/components/vibe-coding/draft-tool-components";
import { Envelope } from "@phosphor-icons/react";
import { AdminEmailOutbox, AdminEmailOutboxStatus } from "@stackframe/stack";
import { KnownErrors } from "@stackframe/stack-shared/dist/known-errors";
import { runAsynchronously } from "@stackframe/stack-shared/dist/utils/promises";
import { ColumnDef } from "@tanstack/react-table";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppEnabledGuard } from "../../app-enabled-guard";
import { useAdminApp } from "../../use-admin-app";
import { DomainReputationCard } from "../../email-sent/domain-reputation-card";
import { StatsBar, StatsBarData } from "../../email-sent/stats-bar";
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
  const [viewport, setViewport] = useState<ViewportMode>('edit');
  const [wysiwygDebugInfo, setWysiwygDebugInfo] = useState<WysiwygDebugInfo | undefined>(undefined);

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
      await stackAdminApp.updateEmailDraft(draftId, { tsxSource: currentCode, themeId: selectedThemeId });
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
    try {
      await stackAdminApp.updateEmailDraft(draftId, { tsxSource: currentCode, themeId: selectedThemeId });
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
    }
  };

  const previewActions = null;
  const isDirty = draft ? (currentCode !== draft.tsxSource || selectedThemeId !== draft.themeId) : false;

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
            <div className="border-b border-border bg-background">
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

      <Card className="p-4 mt-4">
        <CardContent className="flex flex-col gap-6">
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
          <div className="flex justify-between border-t pt-6">
            <Button type="button" variant="outline" onClick={onBack}>
              Back
            </Button>
            <Button type="button" disabled={!canProceed} onClick={onNext}>
              Next: Schedule
            </Button>
          </div>
        </CardContent>
      </Card>
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

      <Card className="p-4 mt-4">
        <CardContent className="flex flex-col gap-6">
          {/* Summary of recipients */}
          <div className="flex flex-col gap-2 pb-4 border-b">
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
          <div className="flex justify-between border-t pt-6">
            <Button variant="outline" onClick={onBack}>
              Back
            </Button>
            <Button disabled={!canSend} onClick={handleSubmit}>
              {scheduleMode === "scheduled" ? "Schedule" : "Send"}
            </Button>
          </div>
        </CardContent>
      </Card>
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

// Status labels for display
const STATUS_LABELS: Record<AdminEmailOutboxStatus, string> = {
  "paused": "Paused",
  "preparing": "Preparing",
  "rendering": "Rendering",
  "render-error": "Render Error",
  "scheduled": "Scheduled",
  "queued": "Queued",
  "sending": "Sending",
  "server-error": "Server Error",
  "skipped": "Skipped",
  "bounced": "Bounced",
  "delivery-delayed": "Delivery Delayed",
  "sent": "Sent",
  "opened": "Opened",
  "clicked": "Clicked",
  "marked-as-spam": "Marked as Spam",
};

function getStatusBadgeColor(status: AdminEmailOutboxStatus): DesignBadgeColor {
  switch (status) {
    case "sent": {
      return "green";
    }
    case "opened": {
      return "blue";
    }
    case "clicked": {
      return "purple";
    }
    case "bounced":
    case "server-error":
    case "render-error": {
      return "red";
    }
    case "marked-as-spam": {
      return "orange";
    }
    case "paused":
    case "skipped":
    case "preparing":
    case "rendering":
    case "scheduled":
    case "queued":
    case "sending":
    case "delivery-delayed":
    default: {
      return "cyan";
    }
  }
}

function getRecipientDisplay(email: AdminEmailOutbox): string {
  const to = email.to;
  if (to.type === "user-primary-email") {
    return `User: ${to.userId.slice(0, 8)}...`;
  } else if (to.type === "user-custom-emails") {
    return to.emails.length > 0 ? to.emails[0] : `User: ${to.userId.slice(0, 8)}...`;
  } else {
    return to.emails.length > 0 ? to.emails[0] : "No recipients";
  }
}

function getSubjectDisplay(email: AdminEmailOutbox): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Safe access for display, subject may not exist on all status variants
  const subject = (email as any).subject;
  return subject || "(Not yet rendered)";
}

function getTimeDisplay(email: AdminEmailOutbox): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Safe access for display, deliveredAt may not exist on all status variants
  const deliveredAt = (email as any).deliveredAt;
  if (deliveredAt) {
    return new Date(deliveredAt).toLocaleString();
  }
  return email.scheduledAt.toLocaleString();
}

const sentEmailTableColumns: ColumnDef<AdminEmailOutbox>[] = [
  {
    accessorKey: "recipient",
    header: "Recipient",
    cell: ({ row }) => getRecipientDisplay(row.original),
  },
  {
    accessorKey: "subject",
    header: "Subject",
    cell: ({ row }) => getSubjectDisplay(row.original),
  },
  {
    accessorKey: "scheduledAt",
    header: "Time",
    cell: ({ row }) => getTimeDisplay(row.original),
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => {
      const status = row.original.status;
      return (
        <DesignBadge
          label={STATUS_LABELS[status]}
          color={getStatusBadgeColor(status)}
          size="sm"
        />
      );
    },
  },
];

function computeStatsFromEmails(emails: AdminEmailOutbox[]): StatsBarData {
  let sent = 0;
  let bounced = 0;
  let spam = 0;
  let errors = 0;
  let inProgress = 0;

  for (const email of emails) {
    switch (email.status) {
      case "sent":
      case "opened":
      case "clicked":
      case "delivery-delayed":
      case "skipped": {
        sent++;
        break;
      }
      case "bounced": {
        bounced++;
        break;
      }
      case "marked-as-spam": {
        spam++;
        break;
      }
      case "server-error":
      case "render-error": {
        errors++;
        break;
      }
      case "preparing":
      case "rendering":
      case "scheduled":
      case "queued":
      case "sending":
      case "paused":
      default: {
        inProgress++;
        break;
      }
    }
  }

  return { sent, bounced, spam, errors, inProgress };
}

function SentStage({ draftId }: { draftId: string }) {
  const stackAdminApp = useAdminApp();
  const [emailLogs, setEmailLogs] = useState<AdminEmailOutbox[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    runAsynchronously(async () => {
      setLoading(true);
      try {
        const result = await stackAdminApp.listOutboxEmails();
        setEmailLogs(result.items);
      } finally {
        setLoading(false);
      }
    });
  }, [stackAdminApp]);

  const filteredEmails = useMemo(() => {
    return emailLogs.filter((email) => email.emailDraftId === draftId);
  }, [emailLogs, draftId]);

  const stats = useMemo(() => computeStatsFromEmails(filteredEmails), [filteredEmails]);

  const drafts = stackAdminApp.useEmailDrafts();
  const draft = useMemo(() => drafts.find((d) => d.id === draftId), [drafts, draftId]);
  const draftName = draft?.displayName ?? `Draft (${draftId.slice(0, 8)}...)`;

  return (
    <div className="mx-auto w-full max-w-6xl p-4">
      <DraftProgressBar steps={DRAFT_STEPS} currentStep="sent" disableNavigation />

      <div className="flex gap-6 mt-4">
        {/* Left side: Stats bar + Email Log */}
        <div className="flex-1 flex flex-col gap-4">
          {/* Stats bar */}
          <DesignCard
            title="Delivery Stats"
            subtitle={`Stats for ${draftName}`}
            icon={Envelope}
            gradient="default"
            glassmorphic
          >
            <div className="py-2">
              {/* Summary text */}
              <div className="mb-3 text-sm text-center">
                <span className="font-medium">{filteredEmails.length} email{filteredEmails.length !== 1 ? "s" : ""}</span>
                {" — "}
                {stats.sent > 0 && <span className="text-green-600">{stats.sent} delivered</span>}
                {stats.sent > 0 && (stats.inProgress > 0 || stats.bounced > 0 || stats.spam > 0 || stats.errors > 0) && ", "}
                {stats.inProgress > 0 && <span className="text-muted-foreground">{stats.inProgress} pending</span>}
                {stats.inProgress > 0 && (stats.bounced > 0 || stats.spam > 0 || stats.errors > 0) && ", "}
                {(stats.bounced > 0 || stats.spam > 0 || stats.errors > 0) && (
                  <span className="text-red-600">
                    {stats.bounced + stats.spam + stats.errors} issue{stats.bounced + stats.spam + stats.errors !== 1 ? "s" : ""}
                  </span>
                )}
              </div>
              <StatsBar data={stats} />
            </div>
          </DesignCard>

          {/* Email Log */}
          <DesignCard
            title="Recipients"
            subtitle={`Emails sent from ${draftName}`}
            icon={Envelope}
            gradient="default"
            glassmorphic
          >
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-8">
                <Spinner size={16} />
                <Typography variant="secondary">Loading emails...</Typography>
              </div>
            ) : (
              <DesignDataTable
                data={filteredEmails}
                defaultColumnFilters={[]}
                columns={sentEmailTableColumns}
                defaultSorting={[{ id: "scheduledAt", desc: true }]}
              />
            )}
          </DesignCard>
        </div>

        {/* Right side: Domain Reputation */}
        <div className="flex-shrink-0">
          <DomainReputationCard />
        </div>
      </div>
    </div>
  );
}
