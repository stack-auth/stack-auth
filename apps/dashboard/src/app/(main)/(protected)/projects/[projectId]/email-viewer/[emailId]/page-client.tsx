"use client";

import { SettingCard } from "@/components/settings";
import { ActionDialog, Badge, Button, Input, Label, Spinner, Typography, useToast } from "@/components/ui";
import { cn } from "@/lib/utils";
import { ArrowLeftIcon, PauseIcon, PlayIcon, XCircleIcon } from "@phosphor-icons/react";
import { AdminEmailOutbox, AdminEmailOutboxStatus } from "@stackframe/stack";
import { runAsynchronously } from "@stackframe/stack-shared/dist/utils/promises";
import { useRouter } from "@/components/router";
import { useEffect, useState } from "react";
import { PageLayout } from "../../page-layout";
import { useAdminApp } from "../../use-admin-app";

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

// Editable statuses - emails in these states can be modified
// TODO: Confirm whether 'queued' should be editable - it may be too late in the pipeline
const EDITABLE_STATUSES: AdminEmailOutboxStatus[] = [
  "paused", "preparing", "rendering", "render-error", "scheduled", "queued",
];

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

  // Editable fields state
  const [scheduledAt, setScheduledAt] = useState<string>("");
  const [isPaused, setIsPaused] = useState(false);

  // Fetch email on mount
  useEffect(() => {
    runAsynchronously(async () => {
      setLoading(true);
      try {
        const fetchedEmail = await stackAdminApp.getOutboxEmail(emailId);
        setEmail(fetchedEmail);
        // Initialize editable fields
        setScheduledAt(fetchedEmail.scheduledAt.toISOString().slice(0, 16));
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

  const refreshEmail = async () => {
    try {
      const fetchedEmail = await stackAdminApp.getOutboxEmail(emailId);
      setEmail(fetchedEmail);
      setScheduledAt(fetchedEmail.scheduledAt.toISOString().slice(0, 16));
      setIsPaused(isEmailPaused(fetchedEmail));
    } catch (error) {
      toast({
        title: "Failed to refresh email",
        description: String(error),
        variant: "destructive",
      });
    }
  };

  const handleSave = async () => {
    if (!email) return;
    setIsSaving(true);
    try {
      const updates: { isPaused?: boolean, scheduledAtMillis?: number } = {};
      if (isPaused !== isEmailPaused(email)) {
        updates.isPaused = isPaused;
      }
      const newScheduledAt = new Date(scheduledAt);
      if (newScheduledAt.getTime() !== email.scheduledAt.getTime()) {
        updates.scheduledAtMillis = newScheduledAt.getTime();
      }
      if (Object.keys(updates).length > 0) {
        await stackAdminApp.updateOutboxEmail(email.id, updates);
        toast({
          title: "Email updated",
          description: "The email has been updated successfully.",
          variant: "success",
        });
        await refreshEmail();
      }
    } catch (error) {
      toast({
        title: "Failed to update email",
        description: String(error),
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
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
      description="View and manage this email"
      actions={
        <Button variant="outline" onClick={() => router.back()}>
          <ArrowLeftIcon className="mr-2 h-4 w-4" />
          Back
        </Button>
      }
    >
      <div className="space-y-6">
        {/* Status and Actions */}
        <SettingCard title="Status" description="Current email status and actions">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
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
              {canPause && (
                <Button variant="outline" size="sm" onClick={handlePause}>
                  <PauseIcon className="mr-2 h-4 w-4" />
                  Pause
                </Button>
              )}
              {canUnpause && (
                <Button variant="outline" size="sm" onClick={handleUnpause}>
                  <PlayIcon className="mr-2 h-4 w-4" />
                  Unpause
                </Button>
              )}
              {canCancel && (
                <Button variant="destructive" size="sm" onClick={() => setCancelDialogOpen(true)}>
                  <XCircleIcon className="mr-2 h-4 w-4" />
                  Cancel
                </Button>
              )}
            </div>
          </div>
        </SettingCard>

        {/* Basic Info */}
        <SettingCard title="Basic Information" description="Email metadata and scheduling">
          <div className="grid grid-cols-2 gap-4">
            <PropertyRow label="ID" value={<code className="text-xs bg-muted px-1 py-0.5 rounded break-all">{email.id}</code>} />
            <PropertyRow label="Created" value={email.createdAt.toLocaleString()} />
            <PropertyRow label="Updated" value={email.updatedAt.toLocaleString()} />
            {editable ? (
              <div className="flex flex-col gap-1">
                <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Scheduled At</Label>
                <Input
                  type="datetime-local"
                  value={scheduledAt}
                  onChange={(e) => setScheduledAt(e.target.value)}
                  className="h-8 text-sm"
                />
              </div>
            ) : (
              <PropertyRow label="Scheduled At" value={email.scheduledAt.toLocaleString()} />
            )}
          </div>
        </SettingCard>

        {/* Recipient Info */}
        <SettingCard title="Recipient" description="Email recipient information">
          <div className="grid grid-cols-2 gap-4">
            <PropertyRow label="Type" value={email.to.type} />
            {email.to.type === "user-primary-email" && (
              <PropertyRow label="User ID" value={<code className="text-xs bg-muted px-1 py-0.5 rounded break-all">{email.to.userId}</code>} />
            )}
            {email.to.type === "user-custom-emails" && (
              <>
                <PropertyRow label="User ID" value={<code className="text-xs bg-muted px-1 py-0.5 rounded break-all">{email.to.userId}</code>} />
                <PropertyRow label="Emails" value={email.to.emails.join(", ") || "None"} className="col-span-2" />
              </>
            )}
            {email.to.type === "custom-emails" && (
              <PropertyRow label="Emails" value={email.to.emails.join(", ") || "None"} className="col-span-2" />
            )}
          </div>
        </SettingCard>

        {/* Rendering Info */}
        {displayData.startedRenderingAt && (
          <SettingCard title="Rendering" description="Email rendering details">
            <div className="grid grid-cols-2 gap-4">
              <PropertyRow label="Started Rendering" value={displayData.startedRenderingAt.toLocaleString()} />
              {displayData.renderedAt && (
                <PropertyRow label="Rendered At" value={displayData.renderedAt.toLocaleString()} />
              )}
              {displayData.subject && (
                <PropertyRow label="Subject" value={displayData.subject} className="col-span-2" />
              )}
              {displayData.isTransactional !== undefined && (
                <PropertyRow label="Transactional" value={displayData.isTransactional ? "Yes" : "No"} />
              )}
              {displayData.isHighPriority !== undefined && (
                <PropertyRow label="High Priority" value={displayData.isHighPriority ? "Yes" : "No"} />
              )}
            </div>
          </SettingCard>
        )}

        {/* Render Error */}
        {displayData.renderError && (
          <SettingCard title="Render Error" description="Error that occurred during rendering">
            <pre className="text-xs bg-destructive/10 text-destructive p-3 rounded overflow-x-auto whitespace-pre-wrap break-words">
              {displayData.renderError}
            </pre>
          </SettingCard>
        )}

        {/* Sending Info */}
        {displayData.startedSendingAt && (
          <SettingCard title="Sending" description="Email sending details">
            <div className="grid grid-cols-2 gap-4">
              <PropertyRow label="Started Sending" value={displayData.startedSendingAt.toLocaleString()} />
              {displayData.deliveredAt && (
                <PropertyRow label="Delivered At" value={displayData.deliveredAt.toLocaleString()} />
              )}
            </div>
          </SettingCard>
        )}

        {/* Server Error */}
        {displayData.serverError && (
          <SettingCard title="Server Error" description="Error that occurred during sending">
            <pre className="text-xs bg-destructive/10 text-destructive p-3 rounded overflow-x-auto whitespace-pre-wrap break-words">
              {displayData.serverError}
            </pre>
          </SettingCard>
        )}

        {/* Skipped Info */}
        {displayData.skippedAt && (
          <SettingCard title="Skipped" description="Email was skipped">
            <div className="grid grid-cols-2 gap-4">
              <PropertyRow label="Skipped At" value={displayData.skippedAt.toLocaleString()} />
              {displayData.skippedReason && <PropertyRow label="Reason" value={displayData.skippedReason} />}
              {displayData.skippedDetails && Object.keys(displayData.skippedDetails).length > 0 && (
                <PropertyRow
                  label="Details"
                  value={<pre className="text-xs bg-muted p-2 rounded overflow-x-auto whitespace-pre-wrap break-words">{JSON.stringify(displayData.skippedDetails, null, 2)}</pre>}
                  className="col-span-2"
                />
              )}
            </div>
          </SettingCard>
        )}

        {/* Bounce Info */}
        {displayData.bouncedAt && (
          <SettingCard title="Bounced" description="Email bounced">
            <div className="grid grid-cols-2 gap-4">
              <PropertyRow label="Bounced At" value={displayData.bouncedAt.toLocaleString()} />
            </div>
          </SettingCard>
        )}

        {/* Delivery Delayed Info */}
        {displayData.deliveryDelayedAt && (
          <SettingCard title="Delivery Delayed" description="Email delivery was delayed">
            <div className="grid grid-cols-2 gap-4">
              <PropertyRow label="Delayed At" value={displayData.deliveryDelayedAt.toLocaleString()} />
            </div>
          </SettingCard>
        )}

        {/* Delivery Tracking */}
        {(displayData.openedAt || displayData.clickedAt || displayData.markedAsSpamAt) && (
          <SettingCard title="Delivery Tracking" description="Email engagement tracking">
            <div className="grid grid-cols-2 gap-4">
              {displayData.openedAt && (
                <PropertyRow label="Opened At" value={displayData.openedAt.toLocaleString()} />
              )}
              {displayData.clickedAt && (
                <PropertyRow label="Clicked At" value={displayData.clickedAt.toLocaleString()} />
              )}
              {displayData.markedAsSpamAt && (
                <PropertyRow label="Marked as Spam At" value={displayData.markedAsSpamAt.toLocaleString()} />
              )}
            </div>
          </SettingCard>
        )}

        {/* Email Content Preview */}
        {displayData.subject && (
          <SettingCard title="Email Content" description="Preview of the email content">
            <div className="space-y-4">
              <PropertyRow label="Subject" value={displayData.subject} />
              {displayData.html && (
                <div>
                  <Typography className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">HTML Preview</Typography>
                  <div className="border rounded-lg p-4 bg-white dark:bg-zinc-900 max-h-96 overflow-auto">
                    <iframe
                      srcDoc={displayData.html}
                      className="w-full h-64 border-0"
                      sandbox="allow-same-origin"
                      title="Email HTML Preview"
                    />
                  </div>
                </div>
              )}
              {displayData.text && (
                <div>
                  <Typography className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Text Version</Typography>
                  <pre className="text-xs bg-muted p-3 rounded overflow-x-auto whitespace-pre-wrap break-words max-h-48">
                    {displayData.text}
                  </pre>
                </div>
              )}
            </div>
          </SettingCard>
        )}

        {/* Save Button (only show if editable and has changes) */}
        {editable && (
          <div className="flex justify-end">
            <Button onClick={handleSave} disabled={isSaving}>
              {isSaving ? "Saving..." : "Save Changes"}
            </Button>
          </div>
        )}
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
