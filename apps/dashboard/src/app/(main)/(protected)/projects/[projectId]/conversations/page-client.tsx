"use client";

import { useAdminApp } from "@/app/(main)/(protected)/projects/[projectId]/use-admin-app";
import { UserSearchPicker } from "@/components/data-table/user-search-picker";
import { useRouter } from "@/components/router";
import { DesignAlert, DesignBadge, DesignCard, DesignCategoryTabs, DesignInput, DesignPillToggle, DesignSelectorDropdown } from "@/components/design-components";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Spinner,
  Textarea,
  Typography,
  cn,
} from "@/components/ui";
import {
  appendConversationUpdate,
  createConversation,
  getConversation,
  listConversations,
} from "@/lib/conversations";
import {
  type ConversationDetailResponse,
  type ConversationPriority,
  type ConversationSource,
  type ConversationStatus,
  type ConversationSummary,
} from "@/lib/conversation-types";
import { useUser } from "@stackframe/stack";
import { fromNow } from "@stackframe/stack-shared/dist/utils/dates";
import { throwErr } from "@stackframe/stack-shared/dist/utils/errors";
import { urlString } from "@stackframe/stack-shared/dist/utils/urls";
import {
  ArrowLeftIcon,
  ArrowSquareOutIcon,
  ArrowsClockwiseIcon,
  ChatCircleDotsIcon,
  HeadsetIcon,
  MagnifyingGlassIcon,
  NotePencilIcon,
  PlusIcon,
  XIcon,
} from "@phosphor-icons/react";
import { useSearchParams } from "next/navigation";
import { useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";
import { AppEnabledGuard } from "../app-enabled-guard";
import { PageLayout } from "../page-layout";

const EMPTY_USER_ID = "00000000-0000-4000-8000-000000000000";

const PRIORITY_OPTIONS: Array<{ id: ConversationPriority, label: string, color: "blue" | "orange" | "red" | "purple" }> = [
  { id: "low", label: "Low", color: "purple" },
  { id: "normal", label: "Normal", color: "blue" },
  { id: "high", label: "High", color: "orange" },
  { id: "urgent", label: "Urgent", color: "red" },
];

const STATUS_FILTER_OPTIONS = [
  { id: "all", label: "All" },
  { id: "open", label: "Open" },
  { id: "pending", label: "Pending" },
  { id: "closed", label: "Closed" },
] as const;

function getPriorityMeta(priority: ConversationPriority) {
  return PRIORITY_OPTIONS.find((option) => option.id === priority) ?? PRIORITY_OPTIONS[1];
}

function getStatusBadge(status: ConversationStatus) {
  if (status === "open") {
    return { label: "Open", color: "green" as const };
  }
  if (status === "pending") {
    return { label: "Pending", color: "orange" as const };
  }
  return { label: "Closed", color: "red" as const };
}

function getSourceBadge(source: ConversationSource) {
  if (source === "chat") {
    return { label: "Chat", color: "blue" as const };
  }
  if (source === "email") {
    return { label: "Email", color: "orange" as const };
  }
  if (source === "api") {
    return { label: "API", color: "green" as const };
  }
  return { label: "Manual", color: "purple" as const };
}

function getConversationQueueLabel(status: ConversationStatus) {
  if (status === "pending") {
    return "Waiting on user";
  }
  if (status === "closed") {
    return "Resolved";
  }
  return "Needs support";
}

function formatSupportTimestamp(value: string) {
  return fromNow(new Date(value));
}

function formatAbsoluteTimestamp(value: string | null) {
  if (value == null) {
    return "Not set";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Invalid date";
  }
  return date.toLocaleString();
}

function parseTagInput(value: string) {
  const tags = value
    .split(",")
    .map((tag) => tag.trim())
    .filter((tag) => tag !== "");
  return Array.from(new Set(tags));
}

function getTeamMemberDisplayName(member: {
  id: string,
  teamProfile?: { displayName?: string | null } | null,
  primaryEmail?: string | null,
}) {
  const teamProfileDisplayName = member.teamProfile?.displayName;
  if (teamProfileDisplayName != null && teamProfileDisplayName.trim() !== "") {
    return teamProfileDisplayName;
  }
  if (member.primaryEmail != null && member.primaryEmail.trim() !== "") {
    return member.primaryEmail;
  }
  return member.id;
}

function getStatusChangeTarget(message: ConversationDetailResponse["messages"][number]) {
  if (typeof message.metadata !== "object" || message.metadata == null || !("status" in message.metadata)) {
    return message.status;
  }
  const nextStatus = message.metadata.status;
  return typeof nextStatus === "string" ? nextStatus : message.status;
}

function getConversationSenderLabel(message: ConversationDetailResponse["messages"][number]) {
  return message.sender.displayName ?? message.sender.primaryEmail ?? (
    message.sender.type === "user" ? "Customer" : message.sender.type === "agent" ? "Support" : "System"
  );
}

function SupportChatMessage(props: {
  message: ConversationDetailResponse["messages"][number],
  conversation: ConversationSummary,
}) {
  const trimmedBody = props.message.body?.trim() ?? "";
  if (props.message.messageType !== "status-change" && trimmedBody === "") {
    return null;
  }

  const senderLabel = getConversationSenderLabel(props.message);
  const timestampLabel = formatSupportTimestamp(props.message.createdAt);

  if (props.message.messageType === "status-change") {
    const statusText = trimmedBody !== "" ? trimmedBody : `Conversation marked ${getStatusChangeTarget(props.message)}`;
    return (
      <div className="flex w-full min-w-0 justify-center py-2">
        <div className="inline-flex max-w-[92%] items-center gap-2 rounded-full border border-border/60 bg-foreground/[0.02] px-3 py-1.5">
          <ArrowsClockwiseIcon className="h-3.5 w-3.5 text-muted-foreground" />
          <Typography className="text-[12px] leading-snug text-foreground/90">{statusText}</Typography>
          <Typography variant="secondary" className="text-[11px] tabular-nums">
            {timestampLabel}
          </Typography>
        </div>
      </div>
    );
  }

  const customerName = props.conversation.userDisplayName ?? props.conversation.userPrimaryEmail ?? "Customer";

  if (props.message.messageType === "internal-note") {
    return (
      <div className="w-full min-w-0 py-1">
        <div className="flex w-full min-w-0 gap-3 rounded-md border border-dashed border-purple-400/35 bg-purple-500/[0.04] px-3 py-2.5">
          <div className="flex shrink-0 flex-col items-center pt-0.5">
            <NotePencilIcon className="h-3.5 w-3.5 text-purple-300/90" aria-hidden />
            <div className="mt-1.5 w-px flex-1 min-h-[1.25rem] bg-purple-400/25" aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <Typography className="text-[10px] font-semibold uppercase tracking-wide text-purple-200/90">
                  Internal note
                </Typography>
                <Typography variant="secondary" className="text-[11px] text-foreground/55">
                  {senderLabel}
                </Typography>
              </div>
              <Typography variant="secondary" className="shrink-0 text-[11px] tabular-nums text-foreground/45">
                {timestampLabel}
              </Typography>
            </div>
            <Typography className="mt-1.5 whitespace-pre-wrap text-[13px] leading-relaxed text-foreground/85">
              {trimmedBody}
            </Typography>
          </div>
        </div>
      </div>
    );
  }

  const isCustomer = props.message.sender.type === "user";
  /** Reserve avatar (2rem) + gap (gap-2 = 0.5rem) so %/calc max-widths resolve against the full row width. */
  const bubbleMaxClass = "max-w-[min(720px,calc(100%-2.5rem))]";
  const bubble = (
    <div
      className={cn(
        "rounded-2xl px-3.5 py-2.5",
        isCustomer ? "rounded-bl-md border border-white/10 bg-background/45" : "rounded-br-md bg-blue-500/10",
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Typography variant="secondary" className="text-[11px]">
          {isCustomer ? customerName : senderLabel}
        </Typography>
        <Typography variant="secondary" className="text-[11px] tabular-nums">
          {timestampLabel}
        </Typography>
      </div>
      <Typography className="mt-1 whitespace-pre-wrap text-[13px] leading-relaxed">{trimmedBody}</Typography>
    </div>
  );

  if (isCustomer) {
    const initialsSource = props.conversation.userDisplayName ?? props.conversation.userPrimaryEmail ?? "??";
    return (
      <div className="flex w-full min-w-0 justify-start">
        <div className="flex w-full min-w-0 items-end justify-start gap-2">
          <div className="shrink-0 pb-0.5">
            <Avatar className="h-8 w-8">
              <AvatarImage src={props.conversation.userProfileImageUrl ?? undefined} alt={customerName} />
              <AvatarFallback>{initialsSource.slice(0, 2)}</AvatarFallback>
            </Avatar>
          </div>
          <div className={cn("min-w-0", bubbleMaxClass)}>
            {bubble}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex w-full min-w-0 justify-end">
      <div className="flex w-full min-w-0 items-end justify-end gap-2">
        <div className={cn("min-w-0", bubbleMaxClass)}>
          {bubble}
        </div>
        <div className="shrink-0 pb-0.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-foreground/[0.03]">
            <HeadsetIcon className="h-4 w-4 text-muted-foreground" />
          </div>
        </div>
      </div>
    </div>
  );
}

function SupportUserHeader(props: {
  displayName: string | null,
  primaryEmail: string | null,
  profileImageUrl: string | null,
  size?: "default" | "compact",
}) {
  const name = props.displayName ?? props.primaryEmail ?? "Unknown user";
  const size = props.size ?? "default";
  return (
    <div className="flex items-center gap-3">
      <Avatar className={cn(size === "compact" ? "h-9 w-9" : "h-11 w-11")}>
        <AvatarImage src={props.profileImageUrl ?? undefined} alt={name} />
        <AvatarFallback>{name.slice(0, 2)}</AvatarFallback>
      </Avatar>
      <div className="min-w-0">
        <Typography className={cn("truncate font-medium", size === "compact" ? "text-xs" : "text-sm")}>{name}</Typography>
        <Typography variant="secondary" className={cn("truncate", size === "compact" ? "text-[11px]" : "text-xs")}>
          {props.primaryEmail ?? "No primary email"}
        </Typography>
      </div>
    </div>
  );
}

function NewConversationDialog(props: {
  open: boolean,
  onOpenChange: (open: boolean) => void,
  currentUser: { getAccessToken: () => Promise<string | null> } | null,
  projectId: string,
  initialUserId?: string | null,
  initialUserLabel?: string | null,
  onCreated: (conversationId: string, userId: string) => void,
}) {
  const [selectedUserId, setSelectedUserId] = useState<string | null>(props.initialUserId ?? null);
  const [selectedUserLabel, setSelectedUserLabel] = useState<string | null>(props.initialUserLabel ?? null);
  const [subject, setSubject] = useState("");
  const [initialMessage, setInitialMessage] = useState("");
  const [priority, setPriority] = useState<ConversationPriority>("normal");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!props.open) {
      return;
    }
    setSelectedUserId(props.initialUserId ?? null);
    setSelectedUserLabel(props.initialUserLabel ?? null);
    setSubject("");
    setInitialMessage("");
    setPriority("normal");
    setErrorMessage(null);
  }, [props.initialUserId, props.initialUserLabel, props.open]);

  const canSubmit = subject.trim() !== "" && initialMessage.trim() !== "";

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Create conversation</DialogTitle>
          <DialogDescription>
            Start a support conversation for a user and keep replies, notes, and context in one place.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Typography className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              User
            </Typography>
            {selectedUserLabel != null ? (
              <div className="flex items-center justify-between rounded-xl border border-border bg-muted/20 px-3 py-2">
                <Typography className="text-sm">{selectedUserLabel}</Typography>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => {
                    setSelectedUserId(null);
                    setSelectedUserLabel(null);
                  }}
                >
                  <XIcon className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <UserSearchPicker
                action={(user) => (
                  <Button
                    size="sm"
                    onClick={() => {
                      setSelectedUserId(user.id);
                      setSelectedUserLabel(user.displayName ?? user.primaryEmail ?? user.id);
                    }}
                  >
                    Select
                  </Button>
                )}
              />
            )}
          </div>

          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_160px]">
            <div className="flex flex-col gap-2">
              <Typography className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Subject
              </Typography>
              <Input
                value={subject}
                onChange={(event) => setSubject(event.target.value)}
                placeholder="Password reset loop on mobile"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Typography className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Priority
              </Typography>
              <Select value={priority} onValueChange={(value: ConversationPriority) => setPriority(value)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRIORITY_OPTIONS.map((option) => (
                    <SelectItem key={option.id} value={option.id}>{option.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Typography className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Initial message
            </Typography>
            <Textarea
              value={initialMessage}
              onChange={(event) => setInitialMessage(event.target.value)}
              placeholder="Describe the issue, customer context, and what support should do next."
              className="min-h-32"
            />
          </div>

          {errorMessage != null && (
            <DesignAlert
              variant="error"
              title="Could not create conversation"
              description={errorMessage}
            />
          )}

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => props.onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              disabled={selectedUserId == null || !canSubmit || isSubmitting}
              onClick={async () => {
                if (!canSubmit) {
                  return;
                }
                const nextUserId = selectedUserId;
                if (nextUserId == null) {
                  throw new Error("A support conversation must be attached to a selected user.");
                }

                setIsSubmitting(true);
                setErrorMessage(null);
                try {
                  const result = await createConversation(props.currentUser, {
                    projectId: props.projectId,
                    userId: nextUserId,
                    subject: subject.trim(),
                    initialMessage: initialMessage.trim(),
                    priority,
                  });
                  props.onCreated(result.conversationId, nextUserId);
                  props.onOpenChange(false);
                } catch (error) {
                  setErrorMessage(error instanceof Error ? error.message : "Unknown error");
                } finally {
                  setIsSubmitting(false);
                }
              }}
            >
              {isSubmitting ? <Spinner className="mr-2 h-4 w-4" /> : <PlusIcon className="mr-2 h-4 w-4" />}
              Create Conversation
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SupportComposer(props: {
  detail: ConversationDetailResponse,
  onUpdated: (detail: ConversationDetailResponse) => void,
  currentUser: { getAccessToken: () => Promise<string | null> } | null,
  projectId: string,
}) {
  const [mode, setMode] = useState<"reply" | "internal-note">("reply");
  const [body, setBody] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    setBody("");
    setErrorMessage(null);
  }, [props.detail.conversation.conversationId]);

  return (
    <DesignCard className="rounded-2xl" contentClassName="p-5">
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <Typography className="text-sm font-medium">Reply or note</Typography>
            <Typography variant="secondary" className="text-xs">
              Support replies stay in the user-facing conversation. Internal notes stay visible only to the support team.
            </Typography>
          </div>
          <DesignPillToggle
            options={[
              { id: "reply", label: "Support Reply" },
              { id: "internal-note", label: "Internal Note" },
            ]}
            selected={mode}
            onSelect={(id) => setMode(id === "internal-note" ? "internal-note" : "reply")}
            size="sm"
            gradient="blue"
          />
        </div>

        <Textarea
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder={mode === "reply" ? "Write the reply that the user should see..." : "Write an internal note for the support team..."}
          className="min-h-32"
        />

        {errorMessage != null && (
          <DesignAlert
            variant="error"
            title="Could not update conversation"
            description={errorMessage}
          />
        )}

        <div className="flex justify-end">
          <Button
            disabled={body.trim() === "" || isSubmitting}
            onClick={async () => {
              setIsSubmitting(true);
              setErrorMessage(null);
              try {
                if (mode === "reply" && props.detail.conversation.metadata.assignedToUserId == null) {
                  const currentUserId = (
                    typeof props.currentUser === "object"
                    && props.currentUser != null
                    && "id" in props.currentUser
                    && typeof props.currentUser.id === "string"
                  ) ? props.currentUser.id : null;
                  const currentUserDisplayName = (
                    typeof props.currentUser === "object"
                    && props.currentUser != null
                    && "displayName" in props.currentUser
                    && typeof props.currentUser.displayName === "string"
                  ) ? props.currentUser.displayName : null;
                  if (currentUserId != null) {
                    await appendConversationUpdate(props.currentUser, {
                      projectId: props.projectId,
                      conversationId: props.detail.conversation.conversationId,
                      type: "metadata",
                      assignedToUserId: currentUserId,
                      assignedToDisplayName: currentUserDisplayName,
                    });
                  }
                }

                const nextDetail = await appendConversationUpdate(props.currentUser, {
                  projectId: props.projectId,
                  conversationId: props.detail.conversation.conversationId,
                  type: mode,
                  body: body.trim(),
                });
                props.onUpdated(nextDetail);
                setBody("");
              } catch (error) {
                setErrorMessage(error instanceof Error ? error.message : "Unknown error");
              } finally {
                setIsSubmitting(false);
              }
            }}
          >
            {isSubmitting ? <Spinner className="mr-2 h-4 w-4" /> : mode === "reply" ? <ChatCircleDotsIcon className="mr-2 h-4 w-4" /> : <NotePencilIcon className="mr-2 h-4 w-4" />}
            {mode === "reply" ? "Send Reply" : "Add Note"}
          </Button>
        </div>
      </div>
    </DesignCard>
  );
}

export default function PageClient() {
  const adminApp = useAdminApp();
  const currentUser = useUser({ or: "redirect", projectIdMustMatch: "internal" });
  const project = adminApp.useProject();
  const router = useRouter();
  const searchParams = useSearchParams();

  const projectId = project.id;
  const selectedConversationId = searchParams.get("conversationId") ?? searchParams.get("threadId");
  const selectedUserId = searchParams.get("userId");

  const [searchInput, setSearchInput] = useState("");
  const deferredQuery = useDeferredValue(searchInput.trim());
  const [statusFilter, setStatusFilter] = useState<"all" | ConversationStatus>("open");
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [conversationsLoading, setConversationsLoading] = useState(true);
  const [conversationsError, setConversationsError] = useState<string | null>(null);
  const [conversationDetail, setConversationDetail] = useState<ConversationDetailResponse | null>(null);
  const [conversationLoading, setConversationLoading] = useState(false);
  const [conversationError, setConversationError] = useState<string | null>(null);
  const [newConversationOpen, setNewConversationOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [assignedToDraft, setAssignedToDraft] = useState<{ userId: string | null, displayName: string | null }>({
    userId: null,
    displayName: null,
  });
  const [tagsDraft, setTagsDraft] = useState("");
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [priorityDraft, setPriorityDraft] = useState<ConversationPriority>("normal");

  const resolvedSelectedUserId = selectedUserId ?? conversationDetail?.conversation.userId ?? EMPTY_USER_ID;
  const selectedUser = adminApp.useUser(resolvedSelectedUserId);
  const userTeams = currentUser.useTeams();
  const currentOwnerTeam = useMemo(
    () => userTeams.find((team) => team.id === project.ownerTeamId) ?? throwErr(`Owner team for project "${project.id}" was not found in current user's teams.`),
    [project.id, project.ownerTeamId, userTeams],
  );
  const assignableTeamMembers = currentOwnerTeam.useUsers();

  const assigneeOptions = useMemo(() => {
    return assignableTeamMembers.map((member) => ({
      value: member.id,
      label: getTeamMemberDisplayName(member),
    }));
  }, [assignableTeamMembers]);

  const selectedUserLabel = selectedUser?.displayName ?? selectedUser?.primaryEmail ?? selectedUserId;

  const updateSelection = useCallback((next: { conversationId?: string | null, userId?: string | null }) => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("threadId");

    if (next.conversationId == null) {
      params.delete("conversationId");
    } else {
      params.set("conversationId", next.conversationId);
    }

    if (next.userId == null) {
      params.delete("userId");
    } else {
      params.set("userId", next.userId);
    }

    const basePath = urlString`/projects/${projectId}/conversations`;
    const nextPath = params.toString() ? `${basePath}?${params.toString()}` : basePath;
    router.replace(nextPath);
  }, [projectId, router, searchParams]);

  useEffect(() => {
    let cancelled = false;
    setConversationsLoading(true);
    setConversationsError(null);
    const conversationListRequest = listConversations(currentUser, {
      projectId,
      query: deferredQuery || undefined,
      status: statusFilter === "all" ? undefined : statusFilter,
      userId: selectedUserId ?? undefined,
    });
    conversationListRequest.then((result) => {
      if (cancelled) return;
      setConversations(result.conversations);
    }).catch((error) => {
      if (cancelled) return;
      setConversationsError(error instanceof Error ? error.message : "Unknown error");
      setConversations([]);
    }).finally(() => {
      if (cancelled) return;
      setConversationsLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [currentUser, deferredQuery, projectId, refreshKey, selectedUserId, statusFilter]);

  useEffect(() => {
    if (selectedConversationId == null) {
      setConversationDetail(null);
      setConversationError(null);
      setConversationLoading(false);
      return;
    }

    let cancelled = false;
    setConversationLoading(true);
    setConversationError(null);
    const conversationDetailRequest = getConversation(currentUser, {
      projectId,
      conversationId: selectedConversationId,
    });
    conversationDetailRequest.then((result) => {
      if (cancelled) return;
      setConversationDetail(result);
    }).catch((error) => {
      if (cancelled) return;
      setConversationError(error instanceof Error ? error.message : "Unknown error");
      setConversationDetail(null);
    }).finally(() => {
      if (cancelled) return;
      setConversationLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [currentUser, projectId, selectedConversationId]);

  useEffect(() => {
    if (selectedConversationId == null && selectedUserId != null && conversations.length > 0) {
      updateSelection({ conversationId: conversations[0].conversationId, userId: selectedUserId });
    }
  }, [selectedConversationId, selectedUserId, conversations, updateSelection]);

  const selectedConversationSummary = useMemo(() => {
    return selectedConversationId == null
      ? null
      : conversations.find((conversation) => conversation.conversationId === selectedConversationId) ?? null;
  }, [selectedConversationId, conversations]);
  const selectedConversationDetailId = conversationDetail?.conversation.conversationId;
  const isConversationSelected = selectedConversationId != null;

  useEffect(() => {
    if (conversationDetail == null) {
      setAssignedToDraft({ userId: null, displayName: null });
      setTagsDraft("");
      setSettingsError(null);
      return;
    }
    setAssignedToDraft({
      userId: conversationDetail.conversation.metadata.assignedToUserId,
      displayName: conversationDetail.conversation.metadata.assignedToDisplayName,
    });
    setTagsDraft(conversationDetail.conversation.metadata.tags.join(", "));
    setPriorityDraft(conversationDetail.conversation.priority);
    setSettingsError(null);
  }, [conversationDetail, selectedConversationDetailId]);

  return (
    <AppEnabledGuard appId="support">
      <PageLayout
        {...(!isConversationSelected ? {
          title: "Conversations",
          description: "Unified inbox for customer messages, team replies, and internal notes",
          actions: (
            <Button onClick={() => setNewConversationOpen(true)}>
              <PlusIcon className="mr-2 h-4 w-4" />
              New Conversation
            </Button>
          ),
        } : {})}
      >
        <div className="relative isolate">
          <div className="pointer-events-none absolute inset-x-0 -top-8 -z-10 h-44 bg-gradient-to-b from-blue-500/12 via-cyan-500/8 to-transparent blur-2xl" />
          <div className="grid gap-6">
            {!isConversationSelected && (
              <DesignCard
                className="h-fit rounded-3xl border border-white/10 bg-background/80 shadow-[0_10px_40px_-24px_rgba(30,80,255,0.6)] backdrop-blur-xl"
                contentClassName="overflow-hidden p-0"
              >
                <div className="flex flex-col gap-4 border-b border-border/70 bg-gradient-to-b from-foreground/[0.03] to-transparent px-5 py-5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <Typography className="text-sm font-semibold tracking-wide">Unified inbox</Typography>
                      <Typography variant="secondary" className="mt-1 text-xs">
                        Search conversations by subject or user and jump straight into the full history.
                      </Typography>
                    </div>
                    {selectedUserId != null && (
                      <Button variant="ghost" size="sm" onClick={() => updateSelection({ userId: null, conversationId: null })}>
                        Clear Filter
                      </Button>
                    )}
                  </div>

                  <DesignInput
                    value={searchInput}
                    onChange={(event) => setSearchInput(event.target.value)}
                    placeholder="Search subject, message, or email..."
                    leadingIcon={<MagnifyingGlassIcon className="h-4 w-4" />}
                  />

                  <DesignCategoryTabs
                    categories={STATUS_FILTER_OPTIONS.map((option) => ({ id: option.id, label: option.label }))}
                    selectedCategory={statusFilter}
                    onSelect={(id) => id === "closed" ? setStatusFilter("closed") : id === "pending" ? setStatusFilter("pending") : id === "open" ? setStatusFilter("open") : setStatusFilter("all")}
                    showBadge={false}
                    size="sm"
                    gradient="blue"
                  />
                </div>

                <div className="flex max-h-[760px] flex-col overflow-y-auto px-2 py-2">
                  {conversationsLoading && (
                    <div className="flex items-center justify-center py-10">
                      <Spinner className="h-5 w-5" />
                    </div>
                  )}

                  {!conversationsLoading && conversationsError != null && (
                    <div className="p-4">
                      <DesignAlert variant="error" title="Could not load conversations" description={conversationsError} />
                    </div>
                  )}

                  {!conversationsLoading && conversationsError == null && conversations.length === 0 && (
                    <div className="p-4">
                      <DesignAlert
                        variant="info"
                        title="No conversations yet"
                        description={selectedUserId != null ? "This user does not have any conversations yet. Start one from the main panel." : "Create the first conversation to start building the inbox."}
                      />
                    </div>
                  )}

                  {conversations.map((conversation, index) => {
                    const statusBadge = getStatusBadge(conversation.status);
                    const priorityMeta = getPriorityMeta(conversation.priority);
                    const sourceBadge = getSourceBadge(conversation.source);
                    const isActive = selectedConversationSummary?.conversationId === conversation.conversationId;
                    const assigneeLabel = conversation.metadata.assignedToDisplayName ?? "Unassigned";
                    const queueLabel = getConversationQueueLabel(conversation.status);
                    const firstDueLabel = formatAbsoluteTimestamp(conversation.metadata.firstResponseDueAt);
                    const nextDueLabel = formatAbsoluteTimestamp(conversation.metadata.nextResponseDueAt);
                    return (
                      <div
                        key={conversation.conversationId}
                      >
                        <button
                          className={cn(
                          "w-full rounded-2xl border border-transparent px-2 py-2 text-left",
                          "transition-colors duration-150 hover:transition-none",
                          isActive
                            ? "border-blue-400/25 bg-blue-500/10 shadow-[0_8px_24px_-20px_rgba(30,80,255,0.9)]"
                            : "hover:bg-foreground/[0.03]",
                        )}
                          onClick={() => updateSelection({ conversationId: conversation.conversationId, userId: conversation.userId })}
                        >
                          <div className="flex flex-col gap-2 px-2.5 py-1">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <Typography className="line-clamp-1 text-sm font-semibold leading-tight">{conversation.subject}</Typography>
                                <Typography variant="secondary" className="line-clamp-1 text-[11px] leading-tight">
                                  {conversation.userDisplayName ?? conversation.userPrimaryEmail ?? "Unknown user"}
                                </Typography>
                              </div>
                              <Typography variant="secondary" className="shrink-0 text-[11px] tabular-nums">
                                {formatSupportTimestamp(conversation.lastActivityAt)}
                              </Typography>
                            </div>

                            <div className="flex flex-wrap items-center gap-1.5">
                              <DesignBadge label={statusBadge.label} color={statusBadge.color} size="sm" />
                              <DesignBadge label={priorityMeta.label} color={priorityMeta.color} size="sm" />
                              <DesignBadge label={sourceBadge.label} color={sourceBadge.color} size="sm" />
                              <Typography variant="secondary" className="ml-1 text-[11px]">
                                Owner: {assigneeLabel}
                              </Typography>
                              <Typography variant="secondary" className="text-[11px]">
                                Queue: {queueLabel}
                              </Typography>
                            </div>

                            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                              <span>First due {firstDueLabel}</span>
                              <span>Next due {nextDueLabel}</span>
                            </div>

                            <div className="rounded-md border border-border/60 bg-foreground/[0.03] px-2 py-1.5">
                              <Typography variant="secondary" className="text-[10px] uppercase tracking-wider">
                                Last message
                              </Typography>
                              <Typography className="mt-0.5 line-clamp-1 text-xs leading-relaxed text-foreground/90">
                                &quot;{conversation.preview ?? "No recent message"}&quot;
                              </Typography>
                            </div>
                          </div>
                        </button>
                        {index < conversations.length - 1 && (
                          <div className="mx-3 my-1 border-b border-border/60" />
                        )}
                      </div>
                    );
                  })}
                </div>
              </DesignCard>
            )}

            {isConversationSelected && (
              <div className="flex min-w-0 flex-col gap-4">
                <button
                  type="button"
                  onClick={() => updateSelection({ conversationId: null })}
                  className={cn(
                    "inline-flex items-center gap-1.5 self-start rounded-md px-1 py-1 text-sm text-muted-foreground",
                    "transition-colors duration-150 hover:transition-none hover:text-foreground",
                  )}
                >
                  <ArrowLeftIcon className="h-4 w-4" />
                  <span>Back to inbox</span>
                </button>

                {conversationLoading && (
                  <DesignCard className="rounded-3xl" contentClassName="flex items-center justify-center p-10">
                    <Spinner className="h-5 w-5" />
                  </DesignCard>
                )}

                {!conversationLoading && conversationError != null && (
                  <DesignAlert variant="error" title="Could not load conversation" description={conversationError} />
                )}

                {!conversationLoading && conversationDetail != null && (
                  <>
                    <DesignCard
                      className="rounded-2xl border border-white/10 bg-gradient-to-b from-blue-500/[0.06] via-background/75 to-background/90 shadow-[0_14px_40px_-28px_rgba(30,80,255,0.75)]"
                      contentClassName="p-3"
                    >
                      <div className="flex flex-col gap-3">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                          <SupportUserHeader
                            size="compact"
                            displayName={conversationDetail.conversation.userDisplayName}
                            primaryEmail={conversationDetail.conversation.userPrimaryEmail}
                            profileImageUrl={conversationDetail.conversation.userProfileImageUrl}
                          />

                          <div className="flex items-center gap-2 sm:justify-end">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={async () => {
                                try {
                                  const nextDetail = await appendConversationUpdate(currentUser, {
                                    projectId,
                                    conversationId: conversationDetail.conversation.conversationId,
                                    type: "status",
                                    status: conversationDetail.conversation.status === "closed" ? "open" : "closed",
                                  });
                                  setConversationDetail(nextDetail);
                                  setConversations((current) => current.map((conversation) => (
                                    conversation.conversationId === nextDetail.conversation.conversationId ? nextDetail.conversation : conversation
                                  )));
                                  setRefreshKey((current) => current + 1);
                                } catch (error) {
                                  alert(error instanceof Error ? error.message : "Could not update the conversation status.");
                                }
                              }}
                            >
                              {conversationDetail.conversation.status === "closed" ? "Reopen Conversation" : "Close Conversation"}
                            </Button>
                            <Button
                              variant="outline"
                              size="icon"
                              className="h-8 w-8"
                              disabled={conversationDetail.conversation.userId == null}
                              onClick={() => {
                                const userId = conversationDetail.conversation.userId;
                                if (userId == null) {
                                  return;
                                }
                                router.push(urlString`/projects/${projectId}/users/${userId}`);
                              }}
                            >
                              <ArrowSquareOutIcon className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>

                        <div className="min-w-0">
                          <Typography className="text-lg font-semibold tracking-tight">{conversationDetail.conversation.subject}</Typography>
                          <Typography variant="secondary" className="mt-0.5 text-xs">
                            Last active {formatSupportTimestamp(conversationDetail.conversation.lastActivityAt)}
                          </Typography>
                          <div className="mt-2 flex flex-wrap items-center gap-1.5">
                            <DesignBadge label={getStatusBadge(conversationDetail.conversation.status).label} color={getStatusBadge(conversationDetail.conversation.status).color} size="sm" />
                            <DesignBadge label={getPriorityMeta(conversationDetail.conversation.priority).label} color={getPriorityMeta(conversationDetail.conversation.priority).color} size="sm" />
                            <DesignBadge label={getSourceBadge(conversationDetail.conversation.source).label} color={getSourceBadge(conversationDetail.conversation.source).color} size="sm" />
                          </div>
                        </div>
                      </div>
                    </DesignCard>

                    <DesignCard className="rounded-2xl border border-white/10" contentClassName="p-4">
                      <div className="flex flex-col gap-3">
                        <div className="grid gap-2 rounded-lg border border-border/60 bg-foreground/[0.02] p-2 sm:grid-cols-2 xl:grid-cols-5">
                          {[
                            { label: "First due", value: formatAbsoluteTimestamp(conversationDetail.conversation.metadata.firstResponseDueAt) },
                            { label: "First sent", value: formatAbsoluteTimestamp(conversationDetail.conversation.metadata.firstResponseAt) },
                            { label: "Next due", value: formatAbsoluteTimestamp(conversationDetail.conversation.metadata.nextResponseDueAt) },
                            { label: "Last customer", value: formatAbsoluteTimestamp(conversationDetail.conversation.metadata.lastCustomerReplyAt) },
                            { label: "Last support", value: formatAbsoluteTimestamp(conversationDetail.conversation.metadata.lastAgentReplyAt) },
                          ].map((item) => (
                            <div key={item.label} className="rounded-md border border-border/60 bg-background/50 px-2 py-1.5">
                              <Typography variant="secondary" className="text-[10px] uppercase tracking-wider">
                                {item.label}
                              </Typography>
                              <Typography className="mt-0.5 text-xs">{item.value}</Typography>
                            </div>
                          ))}
                        </div>

                        <div className="grid gap-3 xl:grid-cols-[220px_180px_minmax(0,1fr)_auto] xl:items-end">
                          <div className="flex flex-col gap-1.5">
                            <Typography variant="secondary" className="text-[11px] uppercase tracking-wider">
                              Assignee
                            </Typography>
                            <DesignSelectorDropdown
                              value={assignedToDraft.userId ?? "unassigned"}
                              onValueChange={(value) => {
                                if (value === "unassigned") {
                                setAssignedToDraft({ userId: null, displayName: null });
                                return;
                                }
                                const assigneeOption = assigneeOptions.find((option) => option.value === value);
                                if (assigneeOption == null) {
                                  throw new Error(`Assignee option "${value}" was not found.`);
                                }
                              setAssignedToDraft({
                                userId: assigneeOption.value,
                                displayName: assigneeOption.label,
                              });
                              }}
                              options={[
                                { value: "unassigned", label: "Unassigned" },
                                ...assigneeOptions,
                              ]}
                              size="sm"
                            />
                          </div>

                          <div className="flex flex-col gap-1.5">
                            <Typography variant="secondary" className="text-[11px] uppercase tracking-wider">
                              Severity
                            </Typography>
                            <DesignSelectorDropdown
                              value={priorityDraft}
                              onValueChange={(value) => {
                                if (value !== "low" && value !== "normal" && value !== "high" && value !== "urgent") {
                                  throw new Error(`Unknown priority value "${value}"`);
                                }
                              setPriorityDraft(value);
                              }}
                              options={PRIORITY_OPTIONS.map((option) => ({ value: option.id, label: option.label }))}
                              size="sm"
                            />
                          </div>

                          <div className="flex flex-col gap-1.5">
                            <Typography variant="secondary" className="text-[11px] uppercase tracking-wider">
                              Tags
                            </Typography>
                            <DesignInput
                              value={tagsDraft}
                              onChange={(event) => setTagsDraft(event.target.value)}
                              placeholder="vip, billing, bug-report"
                            />
                          </div>

                          <div className="flex items-center justify-end gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setAssignedToDraft({ userId: null, displayName: null })}
                            >
                              Unassign
                            </Button>
                            <Button
                              size="sm"
                              disabled={settingsSaving}
                              onClick={async () => {
                              setSettingsSaving(true);
                              setSettingsError(null);
                              try {
                                const nextDetail = await appendConversationUpdate(currentUser, {
                                  projectId,
                                  conversationId: conversationDetail.conversation.conversationId,
                                  type: "metadata",
                                  assignedToUserId: assignedToDraft.userId,
                                  assignedToDisplayName: assignedToDraft.displayName,
                                  priority: priorityDraft,
                                  tags: parseTagInput(tagsDraft),
                                });
                                setConversationDetail(nextDetail);
                                setConversations((current) => current.map((conversation) => (
                                  conversation.conversationId === nextDetail.conversation.conversationId ? nextDetail.conversation : conversation
                                )));
                              } catch (error) {
                                setSettingsError(error instanceof Error ? error.message : "Could not save conversation settings.");
                              } finally {
                                setSettingsSaving(false);
                              }
                              }}
                            >
                              {settingsSaving ? <Spinner className="mr-2 h-4 w-4" /> : null}
                              Save
                            </Button>
                          </div>
                        </div>

                        {settingsError != null && (
                          <Typography className="text-xs text-red-500">{settingsError}</Typography>
                        )}
                      </div>
                    </DesignCard>

                    <DesignCard className="rounded-3xl border border-white/10" contentClassName="overflow-hidden p-0">
                      <div className="border-b border-border/70 bg-foreground/[0.02] px-5 py-4">
                        <Typography className="text-sm font-semibold">Conversation</Typography>
                        <Typography variant="secondary" className="mt-1 text-xs">
                          Customer messages appear on the left; support replies on the right. Internal notes appear as dashed annotations in the timeline and are never visible to the end user.
                        </Typography>
                      </div>
                      <div
                        className="max-h-[min(720px,72vh)] overflow-y-auto px-4 py-4"
                        style={{ scrollbarGutter: "stable" }}
                      >
                        <div className="flex flex-col gap-3">
                          {conversationDetail.messages.map((message) => (
                            <SupportChatMessage key={message.id} message={message} conversation={conversationDetail.conversation} />
                          ))}
                        </div>
                      </div>
                    </DesignCard>

                    <SupportComposer
                      detail={conversationDetail}
                      currentUser={currentUser}
                      projectId={projectId}
                      onUpdated={(nextDetail) => {
                    setConversationDetail(nextDetail);
                    setConversations((current) => {
                      const existing = current.find((conversation) => conversation.conversationId === nextDetail.conversation.conversationId);
                      if (existing == null) {
                        return [nextDetail.conversation, ...current];
                      }
                      return current.map((conversation) => (
                        conversation.conversationId === nextDetail.conversation.conversationId ? nextDetail.conversation : conversation
                      ));
                    });
                    setRefreshKey((current) => current + 1);
                      }}
                    />
                  </>
                )}

                {!conversationLoading && conversationDetail == null && selectedUserId != null && selectedUser != null && (
                  <DesignCard className="rounded-3xl border border-white/10" contentClassName="p-7">
                    <div className="flex flex-col gap-6">
                      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                        <div className="flex flex-col gap-3">
                          <SupportUserHeader
                            displayName={selectedUser.displayName}
                            primaryEmail={selectedUser.primaryEmail}
                            profileImageUrl={selectedUser.profileImageUrl}
                          />
                          <div>
                            <Typography className="text-xl font-semibold">No conversation selected</Typography>
                            <Typography variant="secondary" className="text-sm">
                              This user is selected from Conversations. Start a new conversation or pick an existing one from the inbox.
                            </Typography>
                          </div>
                        </div>

                        <div className="flex flex-wrap gap-2">
                          <Button variant="outline" onClick={() => router.push(urlString`/projects/${projectId}/users/${selectedUser.id}`)}>
                            <ArrowSquareOutIcon className="mr-2 h-4 w-4" />
                            Open User
                          </Button>
                          <Button onClick={() => setNewConversationOpen(true)}>
                            <PlusIcon className="mr-2 h-4 w-4" />
                            Create Conversation
                          </Button>
                        </div>
                      </div>

                      <div className="grid gap-4 md:grid-cols-3">
                        <DesignCard className="rounded-2xl border border-white/10" contentClassName="p-4">
                          <Typography className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Primary Email</Typography>
                          <Typography className="mt-2 text-sm">{selectedUser.primaryEmail ?? "Not set"}</Typography>
                        </DesignCard>
                        <DesignCard className="rounded-2xl border border-white/10" contentClassName="p-4">
                          <Typography className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Signed Up</Typography>
                          <Typography className="mt-2 text-sm">{fromNow(selectedUser.signedUpAt)}</Typography>
                        </DesignCard>
                        <DesignCard className="rounded-2xl border border-white/10" contentClassName="p-4">
                          <Typography className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Last Active</Typography>
                          <Typography className="mt-2 text-sm">{fromNow(selectedUser.lastActiveAt)}</Typography>
                        </DesignCard>
                      </div>
                    </div>
                  </DesignCard>
                )}

                {!conversationLoading && conversationDetail == null && selectedUserId == null && (
                  <DesignCard className="rounded-3xl border border-white/10 bg-gradient-to-b from-blue-500/[0.08] to-background/80" contentClassName="p-10">
                    <div className="flex flex-col items-center gap-4 text-center">
                      <div className="rounded-2xl bg-blue-500/10 p-4 text-blue-600 dark:text-blue-300">
                        <ChatCircleDotsIcon className="h-8 w-8" />
                      </div>
                      <div className="space-y-1">
                        <Typography className="text-lg font-semibold">Pick a conversation or open a user</Typography>
                        <Typography variant="secondary" className="mx-auto max-w-xl text-sm">
                          This inbox is the single place to investigate a user, add internal context, and reply in the same conversation the user sees.
                        </Typography>
                      </div>
                      <Button onClick={() => setNewConversationOpen(true)}>
                        <PlusIcon className="mr-2 h-4 w-4" />
                        Create First Conversation
                      </Button>
                    </div>
                  </DesignCard>
                )}
              </div>
            )}
          </div>
        </div>

        <NewConversationDialog
          open={newConversationOpen}
          onOpenChange={setNewConversationOpen}
          currentUser={currentUser}
          projectId={projectId}
          initialUserId={selectedUserId}
          initialUserLabel={selectedUserLabel}
          onCreated={(conversationId, userId) => {
            updateSelection({ conversationId, userId });
            setRefreshKey((current) => current + 1);
          }}
        />
      </PageLayout>
    </AppEnabledGuard>
  );
}
