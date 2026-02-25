"use client";

import EmailPreview from "@/components/email-preview";
import { EmailThemeSelector } from "@/components/email-theme-selector";
import { DesignButton } from "@/components/design-components/button";
import { ActionDialog, Alert, AlertDescription, AlertTitle, Badge, Button, Input, Label, Spinner, Typography, useToast } from "@/components/ui";
import { CodeEditor, VibeCodeLayout, type ViewportMode } from "@/components/vibe-coding";
import { cn } from "@/lib/utils";
import { ArrowLeftIcon, Info, PauseIcon, PencilSimple, PlayIcon, XCircleIcon } from "@phosphor-icons/react";
import { AdminEmailOutbox, AdminEmailOutboxStatus } from "@stackframe/stack";
import { runAsynchronouslyWithAlert } from "@stackframe/stack-shared/dist/utils/promises";
import { useRouter } from "@/components/router";
import { useCallback, useEffect, useState } from "react";
import { PageLayout } from "../../page-layout";
import { useAdminApp } from "../../use-admin-app";
import { EmailTimeline } from "./email-timeline";

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

// Editable statuses - emails that haven't finished sending can be modified
const EDITABLE_STATUSES: AdminEmailOutboxStatus[] = [
  "paused", "preparing", "rendering", "render-error", "scheduled", "queued", "server-error",
];

function toLocalDatetimeString(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const h = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${d}T${h}:${min}`;
}

function isEditable(email: AdminEmailOutbox): boolean {
  return EDITABLE_STATUSES.includes(email.status);
}

function isEmailPaused(email: AdminEmailOutbox): boolean {
  return (email.status as string) === "paused";
}

function canPauseEmail(email: AdminEmailOutbox): boolean {
  const pausableStatuses = ["preparing", "rendering", "scheduled", "queued", "render-error", "server-error"];
  return !isEmailPaused(email) && pausableStatuses.includes(email.status);
}

function canCancelEmail(email: AdminEmailOutbox): boolean {
  const cancellableStatuses = ["paused", "preparing", "rendering", "scheduled", "queued", "render-error", "server-error"];
  return cancellableStatuses.includes(email.status);
}

function getStatusBadgeVariant(status: AdminEmailOutboxStatus): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "paused":{
      return "outline";
    }
    case "preparing":
    case "rendering":
    case "scheduled":
    case "queued":
    case "sending":
    { return "default"; }
    case "sent":
    case "opened":
    case "clicked":
    case "skipped":
    case "delivery-delayed":
    { return "secondary"; }
    case "bounced":
    case "server-error":
    case "render-error":
    { return "destructive"; }
    case "marked-as-spam":
    { return "outline"; }
    default:
    { return "default"; }
  }
}

// Helper type to extract optional properties from the discriminated union for display
type EmailDisplayData = {
  startedRenderingAt?: Date,
  renderedAt?: Date,
  subject?: string,
  html?: string | null,
  text?: string | null,
  isTransactional?: boolean,
  isHighPriority?: boolean,
  renderError?: string,
  startedSendingAt?: Date,
  deliveredAt?: Date,
  serverError?: string,
  errorAt?: Date,
  skippedAt?: Date,
  skippedReason?: string,
  skippedDetails?: Record<string, unknown>,
  canHaveDeliveryInfo?: boolean,
  bouncedAt?: Date,
  deliveryDelayedAt?: Date,
  openedAt?: Date,
  clickedAt?: Date,
  markedAsSpamAt?: Date,
};

function getEmailDisplayData(email: AdminEmailOutbox): EmailDisplayData {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Safe access for display purposes across discriminated union variants
  const e = email as any;
  return {
    startedRenderingAt: e.startedRenderingAt,
    renderedAt: e.renderedAt,
    subject: e.subject,
    html: e.html,
    text: e.text,
    isTransactional: e.isTransactional,
    isHighPriority: e.isHighPriority,
    renderError: e.renderError,
    startedSendingAt: e.startedSendingAt,
    deliveredAt: e.deliveredAt,
    serverError: e.serverError,
    errorAt: e.errorAt,
    skippedAt: e.skippedAt,
    skippedReason: e.skippedReason,
    skippedDetails: e.skippedDetails,
    canHaveDeliveryInfo: e.canHaveDeliveryInfo,
    bouncedAt: e.bouncedAt,
    deliveryDelayedAt: e.deliveryDelayedAt,
    openedAt: e.openedAt,
    clickedAt: e.clickedAt,
    markedAsSpamAt: e.markedAsSpamAt,
  };
}

function getRecipientDisplay(email: AdminEmailOutbox): string {
  const to = email.to;
  if (to.type === "user-primary-email") {
    return `User: ${to.userId}`;
  } else if (to.type === "user-custom-emails") {
    return to.emails.join(", ") || `User: ${to.userId}`;
  } else {
    return to.emails.join(", ") || "No recipients";
  }
}

function PropertyRow({
  label,
  value,
  className,
}: {
  label: string,
  value: React.ReactNode,
  className?: string,
}) {
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <Typography className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</Typography>
      <div className="text-sm">{value}</div>
    </div>
  );
}

export default function PageClient({ emailId }: { emailId: string }) {
  const stackAdminApp = useAdminApp();
  const router = useRouter();
  const { toast } = useToast();

  const [email, setEmail] = useState<AdminEmailOutbox | null>(null);
  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [infoExpanded, setInfoExpanded] = useState(false);

  // Editable fields state
  const [scheduledAt, setScheduledAt] = useState<string>("");
  const [isPaused, setIsPaused] = useState(false);

  // Code editor state
  const [editMode, setEditMode] = useState(false);
  const [currentCode, setCurrentCode] = useState<string>("");
  const [selectedThemeId, setSelectedThemeId] = useState<string | undefined | false>(undefined);
  const [viewport, setViewport] = useState<ViewportMode>("desktop");
  const [autoPausedByEditor, setAutoPausedByEditor] = useState(false);

  // Fetch email on mount
  useEffect(() => {
    runAsynchronouslyWithAlert(async () => {
      setLoading(true);
      try {
        const fetchedEmail = await stackAdminApp.getOutboxEmail(emailId);
        setEmail(fetchedEmail);
        setScheduledAt(toLocalDatetimeString(fetchedEmail.scheduledAt));
        setIsPaused(isEmailPaused(fetchedEmail));
      } catch (error) {
        toast({
          title: "Failed to load email",
          description: String(error),
          variant: "destructive",
        });
      } finally {
        setLoading(false);
      }
    });
  }, [emailId, stackAdminApp, toast]);

  const refreshEmail = useCallback(async () => {
    try {
      const fetchedEmail = await stackAdminApp.getOutboxEmail(emailId);
      setEmail(fetchedEmail);
      setScheduledAt(toLocalDatetimeString(fetchedEmail.scheduledAt));
      setIsPaused(isEmailPaused(fetchedEmail));
    } catch (error) {
      toast({
        title: "Failed to refresh email",
        description: String(error),
        variant: "destructive",
      });
    }
  }, [emailId, stackAdminApp, toast]);

  const enterEditMode = useCallback(async () => {
    if (!email) return;
    setCurrentCode(email.tsxSource);
    setSelectedThemeId(email.themeId ?? undefined);
    if (!isEmailPaused(email)) {
      await stackAdminApp.pauseOutboxEmail(email.id);
      setAutoPausedByEditor(true);
      await refreshEmail();
    }
    setEditMode(true);
  }, [email, stackAdminApp, refreshEmail]);

  const handleEditorSave = useCallback(async () => {
    if (!email) return;
    await stackAdminApp.updateOutboxEmail(email.id, {
      tsxSource: currentCode,
      themeId: selectedThemeId === false ? null : (selectedThemeId ?? null),
    });
    if (autoPausedByEditor) {
      await stackAdminApp.unpauseOutboxEmail(email.id);
      setAutoPausedByEditor(false);
    }
    setEditMode(false);
    await refreshEmail();
  }, [email, stackAdminApp, currentCode, selectedThemeId, autoPausedByEditor, refreshEmail]);

  const handleEditorDiscard = useCallback(async () => {
    if (!email) return;
    if (autoPausedByEditor) {
      await stackAdminApp.unpauseOutboxEmail(email.id);
      setAutoPausedByEditor(false);
    }
    setEditMode(false);
    await refreshEmail();
  }, [email, stackAdminApp, autoPausedByEditor, refreshEmail]);

  const scheduledAtDirty = email ? scheduledAt !== toLocalDatetimeString(email.scheduledAt) : false;

  const handleScheduleSave = async () => {
    if (!email) return;
    setIsSaving(true);
    try {
      await stackAdminApp.updateOutboxEmail(email.id, {
        scheduledAtMillis: new Date(scheduledAt).getTime(),
      });
      toast({ title: "Schedule updated", variant: "success" });
      await refreshEmail();
    } catch (error) {
      toast({ title: "Failed to update schedule", description: String(error), variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  const handleScheduleDiscard = () => {
    if (email) {
      setScheduledAt(toLocalDatetimeString(email.scheduledAt));
    }
  };

  const handlePause = async () => {
    if (!email) return;
    try {
      await stackAdminApp.pauseOutboxEmail(email.id);
      toast({
        title: "Email paused",
        description: "The email has been paused.",
        variant: "success",
      });
      await refreshEmail();
    } catch (error) {
      toast({
        title: "Failed to pause email",
        description: String(error),
        variant: "destructive",
      });
    }
  };

  const handleUnpause = async () => {
    if (!email) return;
    try {
      await stackAdminApp.unpauseOutboxEmail(email.id);
      toast({
        title: "Email unpaused",
        description: "The email has been unpaused and will continue processing.",
        variant: "success",
      });
      await refreshEmail();
    } catch (error) {
      toast({
        title: "Failed to unpause email",
        description: String(error),
        variant: "destructive",
      });
    }
  };

  const handleCancel = async () => {
    if (!email) return;
    try {
      await stackAdminApp.cancelOutboxEmail(email.id);
      toast({
        title: "Email cancelled",
        description: "The email has been cancelled and will not be sent.",
        variant: "success",
      });
      setCancelDialogOpen(false);
      await refreshEmail();
    } catch (error) {
      toast({
        title: "Failed to cancel email",
        description: String(error),
        variant: "destructive",
      });
    }
  };

  if (loading) {
    return (
      <PageLayout title="Email Details" description="Loading...">
        <div className="flex items-center justify-center gap-2 py-8">
          <Spinner size={16} />
          <Typography variant="secondary">Loading email...</Typography>
        </div>
      </PageLayout>
    );
  }

  if (!email) {
    return (
      <PageLayout title="Email Details" description="Email not found">
        <div className="flex flex-col items-center gap-4 py-8">
          <Typography>Email not found</Typography>
          <Button variant="outline" onClick={() => router.back()}>
            <ArrowLeftIcon className="mr-2 h-4 w-4" />
            Go Back
          </Button>
        </div>
      </PageLayout>
    );
  }

  const editable = isEditable(email);
  const displayData = getEmailDisplayData(email);
  const canPause = canPauseEmail(email);
  const canUnpause = isEmailPaused(email);
  const canCancel = canCancelEmail(email);

  return (
    <PageLayout
      title="Email Details"
      actions={
        <DesignButton variant="outline" className="hover:bg-accent" onClick={() => router.back()}>
          <ArrowLeftIcon className="mr-2 h-4 w-4" />
          Back
        </DesignButton>
      }
    >
      <div className="flex gap-6">
        {/* Left column: Vertical Timeline -- pushed down to align below status/scheduled rows */}
        <div className="shrink-0 pt-24" style={{ width: 220 }}>
          <EmailTimeline email={email} />
        </div>

        {/* Right column: Content + Controls */}
        <div className="flex-1 min-w-0 space-y-5">
          {/* Status row */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Badge variant={getStatusBadgeVariant(email.status)} className="text-sm">
                {STATUS_LABELS[email.status]}
              </Badge>
              {isEmailPaused(email) && (
                <Badge variant="outline" className="text-sm">
                  <PauseIcon className="h-3 w-3 mr-1" />
                  Paused
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-2">
              {canPause && !editMode && (
                <DesignButton variant="outline" size="sm" className="hover:bg-accent" onClick={handlePause}>
                  <PauseIcon className="mr-1.5 h-3.5 w-3.5" />
                  Pause
                </DesignButton>
              )}
              {canUnpause && !editMode && (
                <DesignButton variant="outline" size="sm" className="hover:bg-accent" onClick={handleUnpause}>
                  <PlayIcon className="mr-1.5 h-3.5 w-3.5" />
                  Unpause
                </DesignButton>
              )}
              {canCancel && !editMode && (
                <DesignButton variant="destructive" size="sm" onClick={() => setCancelDialogOpen(true)}>
                  <XCircleIcon className="mr-1.5 h-3.5 w-3.5" />
                  Cancel
                </DesignButton>
              )}
            </div>
          </div>

          {/* Scheduled At (with inline save/cancel) */}
          {editable && !editMode ? (
            <div className="flex items-center gap-3">
              <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide shrink-0 w-[100px]">Scheduled At</Label>
              <Input
                type="datetime-local"
                value={scheduledAt}
                onChange={(e) => setScheduledAt(e.target.value)}
                className="h-8 text-sm max-w-[240px]"
              />
              {scheduledAtDirty && (
                <div className="flex items-center gap-1.5">
                  <DesignButton size="sm" variant="secondary" className="h-7 text-xs" onClick={handleScheduleDiscard}>Cancel</DesignButton>
                  <DesignButton size="sm" className="h-7 text-xs" loading={isSaving} onClick={() => runAsynchronouslyWithAlert(handleScheduleSave)}>Save</DesignButton>
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide shrink-0 w-[100px]">Scheduled At</Label>
              <Typography className="text-sm">{email.scheduledAt.toLocaleString()}</Typography>
            </div>
          )}

          {/* Email Content */}
          {editMode ? (
            <>
              <Alert>
                <PauseIcon className="h-4 w-4" />
                <AlertTitle>Email paused for editing</AlertTitle>
                <AlertDescription>Save your changes or discard to resume.</AlertDescription>
              </Alert>
              <div className="h-[500px] rounded-xl overflow-hidden border border-border">
                <VibeCodeLayout
                  viewport={viewport}
                  onViewportChange={setViewport}
                  onSave={handleEditorSave}
                  saveLabel="Save & resume"
                  isDirty={currentCode !== email.tsxSource}
                  editorTitle="Email Source"
                  headerAction={
                    <EmailThemeSelector
                      selectedThemeId={selectedThemeId}
                      onThemeChange={setSelectedThemeId}
                    />
                  }
                  primaryAction={{
                    label: "Discard",
                    onClick: handleEditorDiscard,
                    disabled: false,
                  }}
                  previewComponent={
                    <EmailPreview
                      themeId={selectedThemeId}
                      templateTsxSource={currentCode}
                      viewport={viewport === "desktop" ? undefined : (viewport === "tablet" ? { id: "tablet", name: "Tablet", width: 820, height: 1180, type: "tablet" } : { id: "phone", name: "Phone", width: 390, height: 844, type: "phone" })}
                    />
                  }
                  editorComponent={
                    <CodeEditor
                      code={currentCode}
                      onCodeChange={setCurrentCode}
                    />
                  }
                  chatComponent={<div />}
                />
              </div>
            </>
          ) : (
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-3 min-w-0">
                  <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide shrink-0 w-[100px]">Subject</Label>
                  {displayData.subject ? (
                    <Typography className="text-sm font-medium truncate">{displayData.subject}</Typography>
                  ) : (
                    <Typography variant="secondary" className="text-sm italic">Not yet rendered</Typography>
                  )}
                </div>
                {editable && (
                  <DesignButton variant="outline" size="sm" className="hover:bg-accent" onClick={() => runAsynchronouslyWithAlert(enterEditMode)}>
                    <PencilSimple className="mr-1.5 h-3.5 w-3.5" />
                    Edit Code
                  </DesignButton>
                )}
              </div>
              <div className="h-[400px] rounded-lg overflow-hidden border border-border">
                {displayData.html ? (
                  <iframe
                    srcDoc={displayData.html}
                    className="w-full h-full border-0"
                    sandbox="allow-same-origin"
                    title="Email HTML Preview"
                  />
                ) : (
                  <EmailPreview
                    themeId={email.themeId ?? undefined}
                    templateTsxSource={email.tsxSource}
                    disableResizing
                  />
                )}
              </div>
            </div>
          )}

          {/* Info toggle */}
          <div>
            <button
              type="button"
              onClick={() => setInfoExpanded(!infoExpanded)}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors duration-150 hover:transition-none"
            >
              <Info size={14} weight={infoExpanded ? "fill" : "regular"} />
              <span>{infoExpanded ? "Hide details" : "More details"}</span>
            </button>

            {infoExpanded && (
              <div className="mt-3 p-3 rounded-lg bg-muted/30 space-y-2">
                <PropertyRow label="Email ID" value={<code className="text-xs bg-muted px-1 py-0.5 rounded break-all">{email.id}</code>} />
                <PropertyRow label="Recipient" value={getRecipientDisplay(email)} />
                {email.to.type !== "custom-emails" && (
                  <PropertyRow label="User ID" value={
                    <code className="text-xs bg-muted px-1 py-0.5 rounded break-all">{email.to.userId}</code>
                  } />
                )}
                <PropertyRow label="Created" value={email.createdAt.toLocaleString()} />
                <PropertyRow label="Updated" value={email.updatedAt.toLocaleString()} />
                {displayData.isTransactional !== undefined && (
                  <PropertyRow label="Transactional" value={displayData.isTransactional ? "Yes" : "No"} />
                )}
                {displayData.isHighPriority !== undefined && (
                  <PropertyRow label="High Priority" value={displayData.isHighPriority ? "Yes" : "No"} />
                )}
                {displayData.renderError && (
                  <div>
                    <Typography className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Render Error</Typography>
                    <pre className="text-xs bg-destructive/10 text-destructive p-2 rounded overflow-x-auto whitespace-pre-wrap break-words">{displayData.renderError}</pre>
                  </div>
                )}
                {displayData.serverError && (
                  <div>
                    <Typography className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Server Error</Typography>
                    <pre className="text-xs bg-destructive/10 text-destructive p-2 rounded overflow-x-auto whitespace-pre-wrap break-words">{displayData.serverError}</pre>
                  </div>
                )}
                {displayData.skippedReason && (
                  <PropertyRow label="Skipped Reason" value={displayData.skippedReason} />
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Cancel Dialog */}
      <ActionDialog
        open={cancelDialogOpen}
        onClose={() => setCancelDialogOpen(false)}
        title="Cancel Email"
        cancelButton
        okButton={{
          label: "Cancel Email",
          onClick: handleCancel,
          props: { variant: "destructive" },
        }}
      >
        <Typography>
          Are you sure you want to cancel this email? This action cannot be undone.
        </Typography>
      </ActionDialog>
    </PageLayout>
  );
}
