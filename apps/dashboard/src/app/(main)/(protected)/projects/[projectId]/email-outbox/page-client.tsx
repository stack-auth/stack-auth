"use client";

import { SettingCard } from "@/components/settings";
import { ActionDialog, Badge, Button, DataTable, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, Input, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SimpleTooltip, Switch, Typography, useToast } from "@/components/ui";
import { cn } from "@/lib/utils";
import { DotsThreeIcon, PauseIcon, PlayIcon, XCircleIcon } from "@phosphor-icons/react";
import { AdminEmailOutbox, AdminEmailOutboxSimpleStatus, AdminEmailOutboxStatus } from "@stackframe/stack";
import { fromNow } from "@stackframe/stack-shared/dist/utils/dates";
import { runAsynchronouslyWithAlert } from "@stackframe/stack-shared/dist/utils/promises";
import { ColumnDef } from "@tanstack/react-table";
import { useState } from "react";
import { PageLayout } from "../page-layout";
import { useAdminApp } from "../use-admin-app";

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

const SIMPLE_STATUS_LABELS: Record<AdminEmailOutboxSimpleStatus, string> = {
  "in-progress": "In Progress",
  "ok": "Completed",
  "error": "Error",
};

function getStatusBadgeVariant(simpleStatus: AdminEmailOutboxSimpleStatus): "default" | "secondary" | "destructive" | "outline" {
  switch (simpleStatus) {
    case "ok": {
      return "secondary";
    }
    case "error": {
      return "destructive";
    }
    case "in-progress": {
      return "default";
    }
    default: {
      return "default";
    }
  }
}

function getRecipientDisplay(email: AdminEmailOutbox): string {
  const to = email.to;
  if (to.type === "user-primary-email") {
    return `User: ${to.userId.slice(0, 8)}...`;
  } else if (to.type === "user-custom-emails") {
    return to.emails.join(", ") || `User: ${to.userId.slice(0, 8)}...`;
  } else {
    return to.emails.join(", ") || "No recipients";
  }
}

// Helper to check if email is paused (avoids type narrowing issues)
function isEmailPaused(email: AdminEmailOutbox): boolean {
  // Cast to string to avoid TypeScript complaining about exhaustive type narrowing
  return (email.status as string) === "paused";
}

// Helper to check if we can pause - works with any email type
function canPauseEmail(email: AdminEmailOutbox): boolean {
  const pausableStatuses = ["preparing", "rendering", "scheduled", "queued", "render-error", "server-error"];
  return !isEmailPaused(email) && pausableStatuses.includes(email.status);
}

// Helper to check if we can cancel - works with any email type
function canCancelEmail(email: AdminEmailOutbox): boolean {
  const cancellableStatuses = ["paused", "preparing", "rendering", "scheduled", "queued", "render-error", "server-error"];
  return cancellableStatuses.includes(email.status);
}

function EmailActions({
  email,
  onRefresh,
}: {
  email: AdminEmailOutbox,
  onRefresh: () => Promise<void>,
}) {
  const stackAdminApp = useAdminApp();
  const { toast } = useToast();
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);

  const canPause = canPauseEmail(email);
  const canUnpause = isEmailPaused(email);
  const canCancel = canCancelEmail(email);

  const handlePause = () => {
    runAsynchronouslyWithAlert(async () => {
      await stackAdminApp.pauseOutboxEmail(email.id);
      toast({
        title: "Email paused",
        description: "The email has been paused and will not be sent until unpaused.",
        variant: "success",
      });
      await onRefresh();
    });
  };

  const handleUnpause = () => {
    runAsynchronouslyWithAlert(async () => {
      await stackAdminApp.unpauseOutboxEmail(email.id);
      toast({
        title: "Email unpaused",
        description: "The email will continue processing.",
        variant: "success",
      });
      await onRefresh();
    });
  };

  const handleCancel = async () => {
    await stackAdminApp.cancelOutboxEmail(email.id);
    toast({
      title: "Email cancelled",
      description: "The email has been cancelled and will not be sent.",
      variant: "success",
    });
    setCancelDialogOpen(false);
    await onRefresh();
  };

  if (!canPause && !canUnpause && !canCancel) {
    return null;
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-8 w-8">
            <DotsThreeIcon className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {canPause && (
            <DropdownMenuItem onClick={handlePause}>
              <PauseIcon className="mr-2 h-4 w-4" />
              Pause
            </DropdownMenuItem>
          )}
          {canUnpause && (
            <DropdownMenuItem onClick={handleUnpause}>
              <PlayIcon className="mr-2 h-4 w-4" />
              Unpause
            </DropdownMenuItem>
          )}
          {(canPause || canUnpause) && canCancel && <DropdownMenuSeparator />}
          {canCancel && (
            <DropdownMenuItem
              onClick={() => setCancelDialogOpen(true)}
              className="text-destructive focus:text-destructive"
            >
              <XCircleIcon className="mr-2 h-4 w-4" />
              Cancel
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

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
    </>
  );
}

const EDITABLE_STATUSES: AdminEmailOutboxStatus[] = [
  "paused", "preparing", "rendering", "render-error", "scheduled", "queued", "server-error",
];

function isEditable(email: AdminEmailOutbox): boolean {
  return EDITABLE_STATUSES.includes(email.status);
}

// Helper type to extract optional properties from the discriminated union for display
type EmailDisplayData = {
  // Rendering
  startedRenderingAt?: Date,
  renderedAt?: Date,
  subject?: string,
  isTransactional?: boolean,
  isHighPriority?: boolean,
  renderError?: string,
  // Sending
  startedSendingAt?: Date,
  deliveredAt?: Date,
  serverError?: string,
  errorAt?: Date,
  // Skipped
  skippedAt?: Date,
  skippedReason?: string,
  skippedDetails?: Record<string, unknown>,
  // Tracking
  canHaveDeliveryInfo?: boolean,
  bouncedAt?: Date,
  deliveryDelayedAt?: Date,
  openedAt?: Date,
  clickedAt?: Date,
  markedAsSpamAt?: Date,
};

// Extract display data from any email type
function getEmailDisplayData(email: AdminEmailOutbox): EmailDisplayData {
  // Cast to any to access properties that may not exist on all variants
  // This is safe because we're just extracting values for display
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const e = email as any;
  return {
    startedRenderingAt: e.startedRenderingAt,
    renderedAt: e.renderedAt,
    subject: e.subject,
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

function EmailDetailSheet({
  email,
  open,
  onOpenChange,
  onRefresh,
}: {
  email: AdminEmailOutbox | null,
  open: boolean,
  onOpenChange: (open: boolean) => void,
  onRefresh: () => Promise<void>,
}) {
  const stackAdminApp = useAdminApp();
  const { toast } = useToast();
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Editable fields state
  const [scheduledAt, setScheduledAt] = useState<string>("");
  const [isPaused, setIsPaused] = useState(false);

  // Initialize form when email changes
  const initForm = (e: AdminEmailOutbox) => {
    setScheduledAt(e.scheduledAt.toISOString().slice(0, 16));
    setIsPaused(isEmailPaused(e));
  };

  // Reset form when sheet opens
  if (email && open) {
    // Only reset if values haven't been initialized yet
    const expectedScheduledAt = email.scheduledAt.toISOString().slice(0, 16);
    if (scheduledAt !== expectedScheduledAt && !isSaving) {
      initForm(email);
    }
  }

  if (!email) return null;

  const editable = isEditable(email);
  const displayData = getEmailDisplayData(email);

  const handleSave = async () => {
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
        await onRefresh();
      }
      onOpenChange(false);
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

  const handleCancel = async () => {
    await stackAdminApp.cancelOutboxEmail(email.id);
    toast({
      title: "Email cancelled",
      description: "The email has been cancelled and will not be sent.",
      variant: "success",
    });
    setCancelDialogOpen(false);
    await onRefresh();
    onOpenChange(false);
  };

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Email Details</SheetTitle>
            <SheetDescription>
              View and manage this email
            </SheetDescription>
          </SheetHeader>

          <div className="mt-6 space-y-6">
            {/* Status Section */}
            <div className="flex items-center gap-3">
              <Badge variant={getStatusBadgeVariant(email.simpleStatus)} className="text-sm">
                {STATUS_LABELS[email.status]}
              </Badge>
              {isEmailPaused(email) && (
                <Badge variant="outline" className="text-sm">
                  <PauseIcon className="h-3 w-3 mr-1" />
                  Paused
                </Badge>
              )}
            </div>

            {/* Basic Info */}
            <div className="space-y-4 border-t pt-4">
              <Typography className="font-semibold">Basic Information</Typography>
              <div className="grid grid-cols-2 gap-4">
                <PropertyRow label="ID" value={<code className="text-xs bg-muted px-1 py-0.5 rounded">{email.id}</code>} />
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
            </div>

            {/* Recipient Info */}
            <div className="space-y-4 border-t pt-4">
              <Typography className="font-semibold">Recipient</Typography>
              <div className="grid grid-cols-2 gap-4">
                <PropertyRow label="Type" value={email.to.type} />
                {email.to.type === "user-primary-email" && (
                  <PropertyRow label="User ID" value={<code className="text-xs bg-muted px-1 py-0.5 rounded">{email.to.userId}</code>} />
                )}
                {email.to.type === "user-custom-emails" && (
                  <>
                    <PropertyRow label="User ID" value={<code className="text-xs bg-muted px-1 py-0.5 rounded">{email.to.userId}</code>} />
                    <PropertyRow label="Emails" value={email.to.emails.join(", ") || "None"} className="col-span-2" />
                  </>
                )}
                {email.to.type === "custom-emails" && (
                  <PropertyRow label="Emails" value={email.to.emails.join(", ") || "None"} className="col-span-2" />
                )}
              </div>
            </div>

            {/* Rendering Info */}
            {displayData.startedRenderingAt && (
              <div className="space-y-4 border-t pt-4">
                <Typography className="font-semibold">Rendering</Typography>
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
              </div>
            )}

            {/* Render Error */}
            {displayData.renderError && (
              <div className="space-y-4 border-t pt-4">
                <Typography className="font-semibold text-destructive">Render Error</Typography>
                <pre className="text-xs bg-destructive/10 text-destructive p-3 rounded overflow-x-auto whitespace-pre-wrap break-words">
                  {displayData.renderError}
                </pre>
              </div>
            )}

            {/* Sending Info */}
            {displayData.startedSendingAt && (
              <div className="space-y-4 border-t pt-4">
                <Typography className="font-semibold">Sending</Typography>
                <div className="grid grid-cols-2 gap-4">
                  <PropertyRow label="Started Sending" value={displayData.startedSendingAt.toLocaleString()} />
                  {displayData.deliveredAt && (
                    <PropertyRow label="Delivered At" value={displayData.deliveredAt.toLocaleString()} />
                  )}
                </div>
              </div>
            )}

            {/* Server Error */}
            {displayData.serverError && (
              <div className="space-y-4 border-t pt-4">
                <Typography className="font-semibold text-destructive">Server Error</Typography>
                <pre className="text-xs bg-destructive/10 text-destructive p-3 rounded overflow-x-auto whitespace-pre-wrap break-words">
                  {displayData.serverError}
                </pre>
              </div>
            )}

            {/* Skipped Info */}
            {displayData.skippedAt && (
              <div className="space-y-4 border-t pt-4">
                <Typography className="font-semibold">Skipped</Typography>
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
              </div>
            )}

            {/* Bounce Info */}
            {displayData.bouncedAt && (
              <div className="space-y-4 border-t pt-4">
                <Typography className="font-semibold text-destructive">Bounced</Typography>
                <div className="grid grid-cols-2 gap-4">
                  <PropertyRow label="Bounced At" value={displayData.bouncedAt.toLocaleString()} />
                </div>
              </div>
            )}

            {/* Delivery Delayed Info */}
            {displayData.deliveryDelayedAt && (
              <div className="space-y-4 border-t pt-4">
                <Typography className="font-semibold">Delivery Delayed</Typography>
                <div className="grid grid-cols-2 gap-4">
                  <PropertyRow label="Delayed At" value={displayData.deliveryDelayedAt.toLocaleString()} />
                </div>
              </div>
            )}

            {/* Delivery Tracking */}
            {displayData.canHaveDeliveryInfo !== undefined && (
              <div className="space-y-4 border-t pt-4">
                <Typography className="font-semibold">Delivery Tracking</Typography>
                <div className="grid grid-cols-2 gap-4">
                  <PropertyRow label="Tracking Available" value={displayData.canHaveDeliveryInfo ? "Yes" : "No"} />
                  {displayData.openedAt && <PropertyRow label="Opened At" value={displayData.openedAt.toLocaleString()} />}
                  {displayData.clickedAt && <PropertyRow label="Clicked At" value={displayData.clickedAt.toLocaleString()} />}
                  {displayData.markedAsSpamAt && <PropertyRow label="Marked as Spam At" value={displayData.markedAsSpamAt.toLocaleString()} />}
                </div>
              </div>
            )}

            {/* Controls Section */}
            {editable && (
              <div className="space-y-4 border-t pt-4">
                <Typography className="font-semibold">Controls</Typography>
                <div className="flex items-center justify-between">
                  <div className="flex flex-col gap-1">
                    <Label>Paused</Label>
                    <Typography className="text-xs text-muted-foreground">Pause email processing</Typography>
                  </div>
                  <Switch
                    checked={isPaused}
                    onCheckedChange={setIsPaused}
                  />
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-2 pt-4 border-t">
              {editable && (
                <>
                  <Button onClick={handleSave} disabled={isSaving}>
                    {isSaving ? "Saving..." : "Save Changes"}
                  </Button>
                  <Button
                    variant="destructive"
                    onClick={() => setCancelDialogOpen(true)}
                  >
                    Cancel Email
                  </Button>
                </>
              )}
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Close
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

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
    </>
  );
}

export default function PageClient() {
  const stackAdminApp = useAdminApp();
  const [emails, setEmails] = useState<AdminEmailOutbox[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [simpleStatusFilter, setSimpleStatusFilter] = useState<string>("all");
  const [selectedEmail, setSelectedEmail] = useState<AdminEmailOutbox | null>(null);
  const [detailSheetOpen, setDetailSheetOpen] = useState(false);

  const loadEmails = async () => {
    setLoading(true);
    try {
      const options: { status?: string, simpleStatus?: string } = {};
      if (statusFilter !== "all") {
        options.status = statusFilter;
      }
      if (simpleStatusFilter !== "all") {
        options.simpleStatus = simpleStatusFilter;
      }
      const result = await stackAdminApp.listOutboxEmails(options);
      setEmails(result);
    } finally {
      setLoading(false);
    }
  };

  // Load emails on mount
  useState(() => {
    runAsynchronouslyWithAlert(loadEmails);
  });

  // Reload when filters change
  const handleFilterChange = (newStatusFilter: string, newSimpleStatusFilter: string) => {
    setStatusFilter(newStatusFilter);
    setSimpleStatusFilter(newSimpleStatusFilter);
    // Trigger reload
    setTimeout(() => {
      runAsynchronouslyWithAlert(loadEmails);
    }, 0);
  };

  const columns: ColumnDef<AdminEmailOutbox>[] = [
    {
      accessorKey: "subject",
      header: "Subject",
      cell: ({ row }) => {
        const email = row.original;
        // Subject is only available after rendering - check if it's a rendered status
        const subject = "subject" in email ? email.subject : undefined;
        return (
          <div className="max-w-[200px] truncate">
            <SimpleTooltip tooltip={subject || "Not rendered yet"}>
              <span>{subject || <span className="text-muted-foreground italic">Pending</span>}</span>
            </SimpleTooltip>
          </div>
        );
      },
    },
    {
      accessorKey: "to",
      header: "Recipient",
      cell: ({ row }) => {
        const display = getRecipientDisplay(row.original);
        return (
          <div className="max-w-[150px] truncate">
            <SimpleTooltip tooltip={display}>
              <span className="text-sm">{display}</span>
            </SimpleTooltip>
          </div>
        );
      },
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => {
        const email = row.original;
        const paused = isEmailPaused(email);

        return (
          <div className="flex items-center gap-2">
            <Badge variant={getStatusBadgeVariant(email.simpleStatus)}>
              {STATUS_LABELS[email.status]}
            </Badge>
            {paused && (
              <SimpleTooltip tooltip="This email is paused">
                <PauseIcon className="h-4 w-4 text-muted-foreground" />
              </SimpleTooltip>
            )}
          </div>
        );
      },
    },
    {
      accessorKey: "scheduledAt",
      header: "Scheduled",
      cell: ({ row }) => {
        const date = row.original.scheduledAt;
        return (
          <SimpleTooltip tooltip={date.toLocaleString()}>
            <span className="text-sm text-muted-foreground">{fromNow(date)}</span>
          </SimpleTooltip>
        );
      },
    },
    {
      accessorKey: "createdAt",
      header: "Created",
      cell: ({ row }) => {
        const date = row.original.createdAt;
        return (
          <SimpleTooltip tooltip={date.toLocaleString()}>
            <span className="text-sm text-muted-foreground">{fromNow(date)}</span>
          </SimpleTooltip>
        );
      },
    },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => (
        <EmailActions email={row.original} onRefresh={loadEmails} />
      ),
    },
  ];

  return (
    <PageLayout
      title="Email Outbox"
      description="View and manage scheduled and sent emails"
      actions={
        <Button onClick={() => runAsynchronouslyWithAlert(loadEmails)} variant="outline">
          Refresh
        </Button>
      }
    >
      <SettingCard title="Email Queue" description="All emails in the outbox">
        <div className="flex gap-4 mb-4">
          <div className="flex items-center gap-2">
            <Typography className="text-sm font-medium">Status:</Typography>
            <Select
              value={statusFilter}
              onValueChange={(value) => handleFilterChange(value, simpleStatusFilter)}
            >
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="All statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                {(Object.entries(STATUS_LABELS) as [AdminEmailOutboxStatus, string][]).map(([value, label]) => (
                  <SelectItem key={value} value={value}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <Typography className="text-sm font-medium">Category:</Typography>
            <Select
              value={simpleStatusFilter}
              onValueChange={(value) => handleFilterChange(statusFilter, value)}
            >
              <SelectTrigger className="w-[150px]">
                <SelectValue placeholder="All categories" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All categories</SelectItem>
                {(Object.entries(SIMPLE_STATUS_LABELS) as [AdminEmailOutboxSimpleStatus, string][]).map(([value, label]) => (
                  <SelectItem key={value} value={value}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-8">
            <Typography className="text-muted-foreground">Loading emails...</Typography>
          </div>
        ) : emails.length === 0 ? (
          <div className="flex justify-center py-8">
            <Typography className="text-muted-foreground">No emails found</Typography>
          </div>
        ) : (
          <DataTable
            data={emails}
            columns={columns}
            defaultColumnFilters={[]}
            defaultSorting={[{ id: "createdAt", desc: true }]}
            onRowClick={(email) => {
              setSelectedEmail(email);
              setDetailSheetOpen(true);
            }}
          />
        )}
      </SettingCard>

      <EmailDetailSheet
        email={selectedEmail}
        open={detailSheetOpen}
        onOpenChange={(open) => {
          setDetailSheetOpen(open);
          if (!open) {
            // Refresh the selected email from the list after closing
            if (selectedEmail) {
              const updated = emails.find(e => e.id === selectedEmail.id);
              if (updated) {
                setSelectedEmail(updated);
              }
            }
          }
        }}
        onRefresh={async () => {
          await loadEmails();
          // Update selected email with fresh data
          if (selectedEmail) {
            const updated = emails.find(e => e.id === selectedEmail.id);
            if (updated) {
              setSelectedEmail(updated);
            }
          }
        }}
      />
    </PageLayout>
  );
}

