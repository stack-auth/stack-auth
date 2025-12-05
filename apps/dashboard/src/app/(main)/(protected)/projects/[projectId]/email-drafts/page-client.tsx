"use client";

import { FormDialog } from "@/components/form-dialog";
import { InputField } from "@/components/form-fields";
import { useRouter } from "@/components/router";
import { runAsynchronouslyWithAlert } from "@stackframe/stack-shared/dist/utils/promises";
import { ActionDialog, Alert, AlertDescription, AlertTitle, Button, cn, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, Typography } from "@stackframe/stack-ui";
import { AlertCircle, FileText, MoreVertical, Pencil, Plus, Send } from "lucide-react";
import { useState } from "react";
import * as yup from "yup";
import { AppEnabledGuard } from "../app-enabled-guard";
import { PageLayout } from "../page-layout";
import { useAdminApp } from "../use-admin-app";

// Glassmorphic card component following design guide
function GlassCard({
  children,
  className,
  gradientColor = "blue"
}: {
  children: React.ReactNode,
  className?: string,
  gradientColor?: "blue" | "purple" | "green" | "orange" | "slate" | "cyan",
}) {
  const hoverTints: Record<string, string> = {
    blue: "group-hover:bg-blue-500/[0.03]",
    purple: "group-hover:bg-purple-500/[0.03]",
    green: "group-hover:bg-emerald-500/[0.03]",
    orange: "group-hover:bg-orange-500/[0.03]",
    slate: "group-hover:bg-slate-500/[0.02]",
    cyan: "group-hover:bg-cyan-500/[0.03]",
  };

  return (
    <div className={cn(
      "group relative rounded-2xl bg-background/60 backdrop-blur-xl transition-all duration-150 hover:transition-none",
      "ring-1 ring-foreground/[0.06] hover:ring-foreground/[0.1]",
      "shadow-sm hover:shadow-md",
      className
    )}>
      {/* Subtle glassmorphic background */}
      <div className="absolute inset-0 bg-gradient-to-br from-foreground/[0.02] to-transparent pointer-events-none rounded-2xl overflow-hidden" />
      {/* Accent hover tint */}
      <div className={cn(
        "absolute inset-0 transition-colors duration-150 group-hover:transition-none pointer-events-none rounded-2xl overflow-hidden",
        hoverTints[gradientColor]
      )} />
      <div className="relative">
        {children}
      </div>
    </div>
  );
}

// Section header with icon following design guide
function SectionHeader({ icon: Icon, title }: { icon: React.ElementType, title: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className="p-1.5 rounded-lg bg-foreground/[0.04]">
        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
      </div>
      <span className="text-xs font-semibold text-foreground uppercase tracking-wider">
        {title}
      </span>
    </div>
  );
}

// Draft item card component
function DraftCard({
  draft,
  onOpen,
  onDelete,
}: {
  draft: { id: string, displayName: string },
  onOpen: () => void,
  onDelete: () => void,
}) {
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  return (
    <>
      <div
        className={cn(
          "group/card relative flex items-center justify-between gap-4 p-4 rounded-xl",
          "bg-gray-100/50 dark:bg-foreground/[0.03]",
          "border border-border/30 dark:border-foreground/[0.06]",
          "hover:bg-gray-100 dark:hover:bg-foreground/[0.05]",
          "transition-all duration-150 hover:transition-none cursor-pointer"
        )}
        onClick={onOpen}
      >
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <div className="p-2 rounded-lg bg-foreground/[0.04] shrink-0">
            <FileText className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="min-w-0 flex-1">
            <Typography className="font-medium text-sm truncate">
              {draft.displayName}
            </Typography>
            <Typography variant="secondary" className="text-xs truncate">
              Draft email
            </Typography>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant="secondary"
            size="sm"
            className="h-8 px-3 text-xs gap-1.5 opacity-0 group-hover/card:opacity-100 transition-opacity duration-150"
            onClick={(e) => {
              e.stopPropagation();
              onOpen();
            }}
          >
            <Pencil className="h-3 w-3" />
            Edit
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className={cn(
                  "inline-flex h-7 w-7 items-center justify-center rounded-lg",
                  "text-muted-foreground hover:text-foreground",
                  "hover:bg-foreground/[0.05]",
                  "transition-colors duration-150 hover:transition-none",
                  "opacity-0 group-hover/card:opacity-100"
                )}
                onClick={(e) => e.stopPropagation()}
              >
                <MoreVertical className="h-4 w-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={(e) => {
                  e.stopPropagation();
                  onOpen();
                }}
              >
                Edit
              </DropdownMenuItem>
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={(e) => {
                  e.stopPropagation();
                  setShowDeleteDialog(true);
                }}
              >
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <ActionDialog
        open={showDeleteDialog}
        onOpenChange={setShowDeleteDialog}
        title="Delete Draft"
        danger
        okButton={{
          label: "Delete",
          onClick: async () => {
            onDelete();
            setShowDeleteDialog(false);
          }
        }}
        cancelButton
      >
        Are you sure you want to delete &ldquo;{draft.displayName}&rdquo;? This action cannot be undone.
      </ActionDialog>
    </>
  );
}

// Empty state component
function EmptyState({ onCreateNew }: { onCreateNew: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <div className="p-4 rounded-2xl bg-foreground/[0.04] mb-4">
        <Send className="h-8 w-8 text-muted-foreground/50" />
      </div>
      <Typography className="text-sm font-medium text-foreground mb-1">
        No drafts yet
      </Typography>
      <Typography variant="secondary" className="text-sm mb-4 max-w-xs">
        Create your first email draft to start composing messages
      </Typography>
      <Button onClick={onCreateNew} className="gap-2">
        <Plus className="h-4 w-4" />
        New Draft
      </Button>
    </div>
  );
}

export default function PageClient() {
  const stackAdminApp = useAdminApp();
  const project = stackAdminApp.useProject();
  const emailConfig = project.config.emailConfig;
  const router = useRouter();
  const drafts = stackAdminApp.useEmailDrafts();
  const [sharedSmtpWarningDialogOpen, setSharedSmtpWarningDialogOpen] = useState<string | null>(null);
  const [newDraftDialogOpen, setNewDraftDialogOpen] = useState(false);

  const handleOpenDraft = (draftId: string) => {
    if (emailConfig?.type === 'shared') {
      setSharedSmtpWarningDialogOpen(draftId);
    } else {
      router.push(`email-drafts/${draftId}`);
    }
  };

  const handleDeleteDraft = async (draftId: string) => {
    await stackAdminApp.deleteEmailDraft(draftId);
  };

  return (
    <AppEnabledGuard appId="emails">
      <PageLayout
        title="Email Drafts"
        description="Create, edit, and send email drafts"
        actions={
          <Button onClick={() => setNewDraftDialogOpen(true)} className="gap-2">
            <Plus className="h-4 w-4" />
            New Draft
          </Button>
        }
      >
        <GlassCard gradientColor="slate" className="overflow-hidden">
          <div className="p-5">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <SectionHeader icon={FileText} title="Drafts" />
                <Typography variant="secondary" className="text-sm mt-1">
                  Compose and manage your email drafts
                </Typography>
              </div>
              {drafts.length > 0 && (
                <div className="text-xs text-muted-foreground tabular-nums">
                  {drafts.length} {drafts.length === 1 ? 'draft' : 'drafts'}
                </div>
              )}
            </div>
          </div>

          {/* Shared SMTP Warning */}
          {emailConfig?.type === 'shared' && (
            <div className="border-t border-foreground/[0.05] px-5 py-4">
              <Alert variant="default" className="bg-amber-500/5 border-amber-500/20">
                <AlertCircle className="h-4 w-4 text-amber-500" />
                <AlertTitle className="text-amber-600 dark:text-amber-400">Using shared email server</AlertTitle>
                <AlertDescription className="text-muted-foreground">
                  Configure a custom SMTP server to send manual emails. You can still create and edit drafts.
                </AlertDescription>
              </Alert>
            </div>
          )}

          {/* Drafts List */}
          <div className="border-t border-foreground/[0.05]">
            {drafts.length === 0 ? (
              <EmptyState onCreateNew={() => setNewDraftDialogOpen(true)} />
            ) : (
              <div className="p-4 space-y-2">
                {drafts.map((draft: any) => (
                  <DraftCard
                    key={draft.id}
                    draft={draft}
                    onOpen={() => handleOpenDraft(draft.id)}
                    onDelete={() => runAsynchronouslyWithAlert(handleDeleteDraft(draft.id))}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Add New Draft Button (when drafts exist) */}
          {drafts.length > 0 && (
            <div className="border-t border-foreground/[0.05] p-4">
              <button
                onClick={() => setNewDraftDialogOpen(true)}
                className={cn(
                  "w-full flex items-center justify-center gap-2 py-3 rounded-xl",
                  "border border-dashed border-foreground/[0.1]",
                  "bg-background/40 hover:bg-foreground/[0.03]",
                  "text-muted-foreground hover:text-foreground",
                  "text-sm font-medium",
                  "transition-all duration-150 hover:transition-none"
                )}
              >
                <Plus className="h-4 w-4" />
                Create new draft
              </button>
            </div>
          )}
        </GlassCard>

        {/* Shared SMTP Warning Dialog */}
        <ActionDialog
          open={sharedSmtpWarningDialogOpen !== null}
          onClose={() => setSharedSmtpWarningDialogOpen(null)}
          title="Shared Email Server"
          okButton={{
            label: "Open Draft Anyway",
            onClick: async () => {
              router.push(`email-drafts/${sharedSmtpWarningDialogOpen}`);
            }
          }}
          cancelButton={{ label: "Cancel" }}
        >
          <Alert variant="default" className="bg-amber-500/5 border-amber-500/20">
            <AlertCircle className="h-4 w-4 text-amber-500" />
            <AlertTitle className="text-amber-600 dark:text-amber-400">Warning</AlertTitle>
            <AlertDescription>
              You are using a shared email server. You can open the draft anyway, but you will not be able to send emails.
            </AlertDescription>
          </Alert>
        </ActionDialog>

        {/* New Draft Dialog */}
        <NewDraftDialog
          open={newDraftDialogOpen}
          onOpenChange={setNewDraftDialogOpen}
        />
      </PageLayout>
    </AppEnabledGuard>
  );
}

function NewDraftDialog({
  open,
  onOpenChange,
}: {
  open: boolean,
  onOpenChange: (open: boolean) => void,
}) {
  const stackAdminApp = useAdminApp();
  const router = useRouter();

  const handleCreateNewDraft = async (values: { name: string }) => {
    const draft = await stackAdminApp.createEmailDraft({ displayName: values.name });
    router.push(`email-drafts/${draft.id}`);
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="New Draft"
      onSubmit={handleCreateNewDraft}
      formSchema={yup.object({
        name: yup.string().defined().label("Draft name"),
      })}
      okButton={{ label: "Create Draft" }}
      cancelButton
      render={(form) => (
        <InputField
          control={form.control}
          name="name"
          label="Draft Name"
          placeholder="Enter a name for your draft"
          required
        />
      )}
    />
  );
}
