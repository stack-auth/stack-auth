"use client";

import {
  DesignAlert,
  DesignBadge,
  DesignButton,
  DesignCard,
  DesignMenu,
  DesignSelectorDropdown,
} from "@/components/design-components";
import { Textarea } from "@/components/ui/textarea";
import { RowDetailField } from "../../analytics/shared";
import { ArrowLeftIcon, ArrowRightIcon, BellIcon, BracketsCurlyIcon, ChatCircleTextIcon, ClockCounterClockwiseIcon, ListDashesIcon, PaperclipIcon, ShieldCheckIcon, TagIcon, TreeStructureIcon, UsersThreeIcon, WarningCircleIcon } from "@phosphor-icons/react";
import {
  breadcrumbTimestampMillis,
  formatIssueEventValue,
  getIssueEventPayload,
  type IssueEventField,
  type IssueExceptionValue,
} from "./issue-event";
import { formatAbsoluteTimeFromMillis, formatRelativeTimeFromMillis } from "../format";
import { runAsynchronously } from "@hexclave/shared/dist/utils/promises";
import type { IssueDetailResponse, IssueFrame, IssueListItem, IssueOccurrence, IssueOccurrenceDirection, IssuePriority } from "./issues-data";
import { LogLevelChip } from "../log-level";
import { StackFrameList } from "./stack-frame-list";
import type { StackFrameOrder } from "./stack-frames";
import { IssueReleaseContextSection } from "./issue-release-context";
import { useMemo, useState } from "react";

type IssueTeamOption = { id: string, displayName: string };

function stackFrameView(frame: IssueExceptionValue["frames"][number]): IssueFrame {
  return {
    filename: frame.filename,
    function: frame.function,
    module: frame.module,
    abs_path: frame.abs_path,
    lineno: frame.lineno,
    colno: frame.colno,
    in_app: frame.in_app,
    ...(frame.debug_id === undefined ? {} : { debug_id: frame.debug_id }),
    ...(frame.context === undefined ? {} : { context: frame.context }),
  };
}

function startTriageAction(action: () => Promise<void>): void {
  runAsynchronously(action);
}

function EmptySection({ title, description }: { title: string, description: string }) {
  return <DesignAlert variant="info" title={title} description={description} />;
}

function EventFieldGrid({ fields }: { fields: readonly IssueEventField[] }) {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {fields.map((field) => (
        <div key={field.key} className="min-w-0 rounded-xl bg-foreground/[0.03] px-3 py-2 ring-1 ring-foreground/[0.06]">
          <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{field.key}</div>
          <div className="mt-1 break-words font-mono text-xs text-foreground">{formatIssueEventValue(field.value)}</div>
        </div>
      ))}
    </div>
  );
}

function ExceptionValue({ value, frameOrder }: { value: IssueExceptionValue, frameOrder: StackFrameOrder }) {
  return (
    <li className="space-y-3 rounded-xl bg-foreground/[0.02] p-3 ring-1 ring-foreground/[0.07]">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <DesignBadge label={value.index === 0 ? "Root" : `Cause ${value.index}`} color={value.index === 0 ? "red" : "orange"} size="sm" />
            <span className="font-mono text-sm font-medium text-foreground">{value.type ?? "Unknown exception"}</span>
          </div>
          <p className="mt-1 break-words text-sm text-muted-foreground">
            {value.value ?? "Exception message unavailable"}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {value.mechanism != null && <DesignBadge label={value.mechanism} color="zinc" size="sm" />}
          {value.handled != null && (
            <DesignBadge label={value.handled ? "Handled" : "Unhandled"} color={value.handled ? "zinc" : "red"} size="sm" />
          )}
        </div>
      </div>
      {(value.frames.length > 0 || value.rawStack != null) && (
        <StackFrameList frames={value.frames.map(stackFrameView)} rawStack={value.rawStack} order={frameOrder} />
      )}
      {value.frames.length === 0 && value.rawStack == null && (
        <div className="text-xs text-muted-foreground/70">No stack trace retained for this exception link.</div>
      )}
    </li>
  );
}

function ExceptionChainSection({
  issue,
  occurrence,
  frameOrder,
}: {
  issue: IssueListItem,
  occurrence: IssueOccurrence,
  frameOrder: StackFrameOrder,
}) {
  const payload = getIssueEventPayload(occurrence);
  return (
    <DesignCard title="Exception chain" subtitle="Typed exception values retained in this occurrence" icon={WarningCircleIcon}>
      {payload.exceptionChain.length === 0 ? (
        <div className="space-y-3">
          <div className="rounded-xl bg-foreground/[0.03] p-3 ring-1 ring-foreground/[0.06]">
            <div className="flex flex-wrap items-center gap-2">
              <DesignBadge label="Primary occurrence" color="red" size="sm" />
              <span className="font-mono text-sm font-medium">{issue.type || "Unknown exception"}</span>
            </div>
            <p className="mt-1 break-words text-sm text-muted-foreground">{occurrence.message || "Exception message unavailable"}</p>
          </div>
          <EmptySection
            title="Linked exception chain unavailable"
            description="The current issue-detail response exposes one normalized exception and stack, but does not return linked causes or per-exception metadata for this occurrence."
          />
        </div>
      ) : (
        <ol className="space-y-3">
          {payload.exceptionChain.map((value) => <ExceptionValue key={value.index} value={value} frameOrder={frameOrder} />)}
        </ol>
      )}
    </DesignCard>
  );
}

function RequestContextSection({ occurrence }: { occurrence: IssueOccurrence }) {
  const request = getIssueEventPayload(occurrence).safeRequest;
  return (
    <DesignCard title="Request context" subtitle="Allowlisted fields only" icon={ShieldCheckIcon}>
      {request == null ? (
        <EmptySection
          title="Request context unavailable"
          description="This occurrence payload does not include a retained request projection. Headers, query parameters, cookies, and bodies are intentionally not shown."
        />
      ) : request.fields.length === 0 ? (
        <EmptySection
          title="No safe request fields retained"
          description="A request object was present, but it did not contain one of the display-safe fields: URL, method, or status."
        />
      ) : (
        <div className="space-y-3">
          <EventFieldGrid fields={request.fields} />
          <p className="text-[11px] text-muted-foreground/70">Only URL, method, and status are rendered from request data.</p>
        </div>
      )}
    </DesignCard>
  );
}

function TagsSection({ occurrence }: { occurrence: IssueOccurrence }) {
  const tags = getIssueEventPayload(occurrence).tags;
  return (
    <DesignCard title="Tags" subtitle="Occurrence-scoped labels" icon={TagIcon}>
      {tags.length === 0 ? (
        <EmptySection title="No tags in this occurrence" description="The current occurrence payload did not include tags." />
      ) : (
        <div className="flex flex-wrap gap-2">
          {tags.map((tag) => (
            <div key={tag.key} className="flex min-w-0 items-center gap-1.5 rounded-lg bg-foreground/[0.03] px-2 py-1 ring-1 ring-foreground/[0.06]">
              <span className="max-w-48 truncate font-mono text-[11px] text-muted-foreground" title={tag.key}>{tag.key}</span>
              <DesignBadge label={formatIssueEventValue(tag.value)} color="zinc" size="sm" />
            </div>
          ))}
        </div>
      )}
    </DesignCard>
  );
}

function ContextsSection({ occurrence }: { occurrence: IssueOccurrence }) {
  const contexts = getIssueEventPayload(occurrence).contexts;
  return (
    <DesignCard title="Contexts" subtitle="Structured occurrence context" icon={BracketsCurlyIcon}>
      {contexts.length === 0 ? (
        <EmptySection title="No contexts in this occurrence" description="The current occurrence payload did not include structured contexts." />
      ) : (
        <div className="space-y-4">
          {contexts.map((context) => <RowDetailField key={context.key} column={context.key} value={context.value} />)}
        </div>
      )}
    </DesignCard>
  );
}

function BreadcrumbsSection({ occurrence, nowMs }: { occurrence: IssueOccurrence, nowMs: number }) {
  const breadcrumbs = getIssueEventPayload(occurrence).breadcrumbs;
  return (
    <DesignCard title="Breadcrumbs" subtitle="Events leading up to this occurrence" icon={ListDashesIcon}>
      {breadcrumbs.length === 0 ? (
        <EmptySection title="No breadcrumbs retained" description="This occurrence did not include breadcrumbs in the current event payload." />
      ) : (
        <ol className="space-y-2">
          {breadcrumbs.map((breadcrumb) => {
            const timestamp = breadcrumb.timestamp == null ? null : breadcrumbTimestampMillis(breadcrumb.timestamp);
            return (
              <li key={breadcrumb.index} className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 border-l border-foreground/[0.12] pl-3">
                <span className="font-mono text-[10px] tabular-nums text-muted-foreground/70" title={timestamp == null ? undefined : formatAbsoluteTimeFromMillis(timestamp)}>
                  {timestamp == null ? "No time" : formatRelativeTimeFromMillis(timestamp, nowMs)}
                </span>
                <div className="min-w-0">
                  <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                    {breadcrumb.level != null && <LogLevelChip level={breadcrumb.level} />}
                    {breadcrumb.category != null && <DesignBadge label={breadcrumb.category} color="zinc" size="sm" />}
                  </div>
                  <p className="mt-1 break-words text-xs text-foreground">{breadcrumb.message ?? "Breadcrumb message unavailable"}</p>
                  {breadcrumb.data != null && Object.keys(breadcrumb.data).length > 0 && (
                    <div className="mt-2">
                      <RowDetailField column="data" value={breadcrumb.data} />
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </DesignCard>
  );
}

function GroupingSection({ issue, occurrence }: { issue: IssueListItem, occurrence: IssueOccurrence | null }) {
  const payload = occurrence == null ? null : getIssueEventPayload(occurrence);
  const evidence: IssueEventField[] = [
    { key: "Issue hashes", value: issue.issue_hashes },
    ...payload?.fingerprint.length ? [{ key: "Event fingerprint", value: payload.fingerprint }] : [],
    ...payload?.fingerprintOverride.length ? [{ key: "Fingerprint override", value: payload.fingerprintOverride }] : [],
  ];
  return (
    <DesignCard title="Grouping explanation" subtitle="Evidence available in the current response" icon={TreeStructureIcon}>
      {evidence.length > 0 && (
        <div className="space-y-3">
          {evidence.map((field) => <RowDetailField key={field.key} column={field.key} value={field.value} />)}
        </div>
      )}
      <div className={evidence.length > 0 ? "mt-3" : undefined}>
        <EmptySection
          title="Server grouping provenance unavailable"
          description="The issue-detail API returns issue hashes and any event fingerprint values, but not the active grouping configuration, contributing values, or hash decision trace."
        />
      </div>
    </DesignCard>
  );
}

function AdditionalEventDataSection({ occurrence }: { occurrence: IssueOccurrence }) {
  const payload = getIssueEventPayload(occurrence);
  const fields = [
    ...payload.extra.map((field) => ({ ...field, key: `extra.${field.key}` })),
    ...payload.additionalData,
  ];
  return (
    <DesignCard title="Additional event data" subtitle="Safe fields not rendered in a dedicated section" icon={BracketsCurlyIcon}>
      {fields.length === 0 ? (
        <EmptySection title="No additional event data" description="All retained fields are either shown above or were not present in this occurrence." />
      ) : (
        <div className="space-y-4">
          {fields.map((field) => <RowDetailField key={field.key} column={field.key} value={field.value} />)}
        </div>
      )}
    </DesignCard>
  );
}

function formatAttachmentBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

function AttachmentsSection({ occurrence }: { occurrence: IssueOccurrence }) {
  return (
    <DesignCard title="Attachments" subtitle="Private event files" icon={PaperclipIcon}>
      {occurrence.attachments.length === 0 ? (
        <EmptySection
          title="No attachments retained"
          description="This occurrence has no private attachment metadata. Attachment bytes are never included in the event payload."
        />
      ) : (
        <ul className="space-y-2">
          {occurrence.attachments.map((attachment) => (
            <li key={attachment.id} className="flex min-w-0 items-center justify-between gap-3 rounded-xl bg-foreground/[0.03] px-3 py-2 ring-1 ring-foreground/[0.06]">
              <div className="min-w-0">
                <a className="truncate text-sm font-medium text-foreground underline-offset-2 hover:underline" href={attachment.download_path} download={attachment.filename}>
                  {attachment.filename}
                </a>
                <div className="mt-0.5 flex flex-wrap gap-x-2 text-[11px] text-muted-foreground">
                  <span>{attachment.content_type}</span>
                  <span>{formatAttachmentBytes(attachment.byte_length)}</span>
                  <span>{attachment.attachment_type}</span>
                </div>
              </div>
              <DesignBadge label={attachment.sha256.slice(0, 12)} color="zinc" size="sm" />
            </li>
          ))}
        </ul>
      )}
    </DesignCard>
  );
}

export function IssueProductSection({
  detail,
  onPriorityChange,
  onAddComment,
  currentUserId,
  teams,
  actionLoading,
  onAssignmentChange,
  onTeamChange,
  onOwnerChange,
  onBookmarkChange,
  onSubscriptionChange,
}: {
  detail: IssueDetailResponse,
  onPriorityChange: (priority: IssuePriority | null) => Promise<void>,
  onAddComment: (body: string) => Promise<void>,
  currentUserId: string,
  teams: readonly IssueTeamOption[],
  actionLoading: boolean,
  onAssignmentChange: (userId: string | null) => Promise<void>,
  onTeamChange: (teamId: string | null) => Promise<void>,
  onOwnerChange: (type: "user" | "team", id: string) => Promise<void>,
  onBookmarkChange: (bookmarked: boolean) => Promise<void>,
  onSubscriptionChange: (subscribed: boolean) => Promise<void>,
}) {
  const product = detail.product;
  const priorityColor = product.priority === "high" ? "red" : product.priority === "medium" ? "orange" : "zinc";
  const recentActivities = product.activities.slice(0, 5);
  const recentComments = product.comments.slice(0, 5);
  const [commentDraft, setCommentDraft] = useState("");
  const [commentError, setCommentError] = useState<string | null>(null);
  const [commentSaving, setCommentSaving] = useState(false);
  const isBookmarked = product.bookmarked_user_ids.includes(currentUserId);
  const isSubscribed = product.subscriptions.some((subscription) => subscription.type === "user" && subscription.id === currentUserId && subscription.is_active);
  const manualOwner = product.owners.find((owner) => owner.source === "manual");
  const ownerValue = manualOwner?.type === "user" && manualOwner.user_id === currentUserId
    ? "user:self"
    : manualOwner?.type === "team" && manualOwner.team_id != null && teams.some((team) => team.id === manualOwner.team_id)
      ? `team:${manualOwner.team_id}`
      : "none";
  const teamOptions = useMemo(() => [
    { value: "none", label: "No team" },
    ...teams.map((team) => ({ value: team.id, label: team.displayName })),
  ], [teams]);
  const ownerOptions = useMemo(() => [
    { value: "none", label: "No manual owner" },
    { value: "user:self", label: "You" },
    ...teams.map((team) => ({ value: `team:${team.id}`, label: `Team · ${team.displayName}` })),
  ], [teams]);

  const submitComment = async () => {
    const body = commentDraft.trim();
    if (body === "") {
      setCommentError("Write a comment before saving it.");
      return;
    }
    setCommentError(null);
    setCommentSaving(true);
    try {
      await onAddComment(body);
      setCommentDraft("");
    } catch (error) {
      setCommentError(error instanceof Error ? error.message : String(error));
    } finally {
      setCommentSaving(false);
    }
  };

  return (
    <DesignCard
      title="Triage"
      subtitle="Durable issue ownership and activity"
      icon={UsersThreeIcon}
      actions={
        <DesignMenu
          variant="actions"
          align="end"
          items={[
            { id: "priority-none", label: "Clear priority", onClick: async () => await onPriorityChange(null) },
            { id: "priority-low", label: "Set low priority", onClick: async () => await onPriorityChange("low") },
            { id: "priority-medium", label: "Set medium priority", onClick: async () => await onPriorityChange("medium") },
            { id: "priority-high", label: "Set high priority", onClick: async () => await onPriorityChange("high") },
          ]}
        />
      }
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="min-w-0 rounded-xl bg-foreground/[0.03] px-3 py-2 ring-1 ring-foreground/[0.06]">
          <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Priority</div>
          <div className="mt-1">{product.priority == null ? <span className="text-xs text-muted-foreground">Unset</span> : <DesignBadge label={product.priority} color={priorityColor} size="sm" />}</div>
        </div>
        <div className="min-w-0 rounded-xl bg-foreground/[0.03] px-3 py-2 ring-1 ring-foreground/[0.06]">
          <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Assignee</div>
          <div className="mt-1 truncate font-mono text-xs text-foreground" title={product.assignee_user_id ?? undefined}>{product.assignee_user_id === currentUserId ? "You" : product.assignee_user_id ?? "Unassigned"}</div>
        </div>
        <div className="min-w-0 rounded-xl bg-foreground/[0.03] px-3 py-2 ring-1 ring-foreground/[0.06]">
          <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Team</div>
          <div className="mt-1 truncate font-mono text-xs text-foreground" title={product.team_id ?? undefined}>{teams.find((team) => team.id === product.team_id)?.displayName ?? product.team_id ?? "No team"}</div>
        </div>
      </div>

      <div className="mt-3 grid gap-3 border-t border-foreground/[0.06] pt-3 md:grid-cols-2">
        <div className="space-y-2 rounded-xl bg-foreground/[0.03] p-3 ring-1 ring-foreground/[0.06]">
          <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Assignment</div>
          <div className="flex flex-wrap gap-2">
            <DesignButton size="sm" variant="secondary" loading={actionLoading} onClick={() => onAssignmentChange(currentUserId)}>
              Assign to me
            </DesignButton>
            <DesignButton size="sm" variant="ghost" disabled={actionLoading || product.assignee_user_id == null} onClick={() => onAssignmentChange(null)}>
              Unassign
            </DesignButton>
          </div>
        </div>
        <div className="space-y-2 rounded-xl bg-foreground/[0.03] p-3 ring-1 ring-foreground/[0.06]">
          <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Team assignment</div>
          <DesignSelectorDropdown
            value={product.team_id ?? "none"}
            options={teamOptions}
            disabled={actionLoading}
            triggerId="issue-team-assignment"
            onValueChange={(value) => {
              if (value === "none") startTriageAction(async () => await onTeamChange(null));
              else {
                const team = teams.find((candidate) => candidate.id === value);
                if (team != null) startTriageAction(async () => await onTeamChange(team.id));
              }
            }}
          />
        </div>
        <div className="space-y-2 rounded-xl bg-foreground/[0.03] p-3 ring-1 ring-foreground/[0.06]">
          <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Manual owner</div>
          <DesignSelectorDropdown
            value={ownerValue}
            options={ownerOptions}
            disabled={actionLoading}
            triggerId="issue-owner"
            onValueChange={(value) => {
              if (value === "user:self") startTriageAction(async () => await onOwnerChange("user", currentUserId));
              else if (value.startsWith("team:")) {
                const teamId = value.slice("team:".length);
                if (teams.some((team) => team.id === teamId)) startTriageAction(async () => await onOwnerChange("team", teamId));
              }
            }}
          />
          <div className="text-[11px] text-muted-foreground/70">Ownership metadata is branch-scoped; rule and code-owner records remain visible below.</div>
        </div>
        <div className="space-y-2 rounded-xl bg-foreground/[0.03] p-3 ring-1 ring-foreground/[0.06]">
          <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Personal triage</div>
          <div className="flex flex-wrap gap-2">
            <DesignButton size="sm" variant={isBookmarked ? "secondary" : "ghost"} loading={actionLoading} onClick={() => onBookmarkChange(!isBookmarked)}>
              {isBookmarked ? "Bookmarked" : "Bookmark"}
            </DesignButton>
            <DesignButton size="sm" variant={isSubscribed ? "secondary" : "ghost"} loading={actionLoading} onClick={() => onSubscriptionChange(!isSubscribed)}>
              {isSubscribed ? "Subscribed" : "Subscribe"}
            </DesignButton>
          </div>
          <div className="text-[11px] text-muted-foreground/70">These controls apply to your authenticated dashboard identity.</div>
        </div>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <div className="flex items-center gap-2 rounded-xl bg-foreground/[0.03] px-3 py-2 text-xs text-muted-foreground ring-1 ring-foreground/[0.06]">
          <UsersThreeIcon className="h-3.5 w-3.5" />
          {product.owners.length} owner{product.owners.length === 1 ? "" : "s"}
        </div>
        <div className="flex items-center gap-2 rounded-xl bg-foreground/[0.03] px-3 py-2 text-xs text-muted-foreground ring-1 ring-foreground/[0.06]">
          <BellIcon className="h-3.5 w-3.5" />
          {product.subscriptions.length} subscription{product.subscriptions.length === 1 ? "" : "s"}
        </div>
        <div className="flex items-center gap-2 rounded-xl bg-foreground/[0.03] px-3 py-2 text-xs text-muted-foreground ring-1 ring-foreground/[0.06]">
          <ChatCircleTextIcon className="h-3.5 w-3.5" />
          {product.comments.length} comment{product.comments.length === 1 ? "" : "s"}
        </div>
      </div>

      {(recentActivities.length > 0 || recentComments.length > 0) && (
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          {recentActivities.length > 0 && (
            <div className="min-w-0">
              <div className="mb-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Recent activity</div>
              <ol className="space-y-2">
                {recentActivities.map((activity) => (
                  <li key={activity.id} className="rounded-xl bg-foreground/[0.03] px-3 py-2 text-xs ring-1 ring-foreground/[0.06]">
                    <div className="flex items-center justify-between gap-2">
                      <DesignBadge label={activity.type} color="zinc" size="sm" />
                      <span className="font-mono text-[10px] text-muted-foreground">{activity.occurred_at}</span>
                    </div>
                    {activity.actor_user_id != null && <div className="mt-1 truncate font-mono text-[10px] text-muted-foreground">actor {activity.actor_user_id}</div>}
                  </li>
                ))}
              </ol>
            </div>
          )}
          {recentComments.length > 0 && (
            <div className="min-w-0">
              <div className="mb-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Recent comments</div>
              <ol className="space-y-2">
                {recentComments.map((comment) => (
                  <li key={comment.id} className="rounded-xl bg-foreground/[0.03] px-3 py-2 text-xs ring-1 ring-foreground/[0.06]">
                    <p className="line-clamp-3 break-words text-foreground">{comment.body}</p>
                    <div className="mt-1 truncate font-mono text-[10px] text-muted-foreground">{comment.author_user_id} · {comment.created_at}</div>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>
      )}

      <div className="mt-4 border-t border-foreground/[0.06] pt-4">
        <div className="mb-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Add comment</div>
        <Textarea
          value={commentDraft}
          onChange={(event) => setCommentDraft(event.target.value)}
          placeholder="Record the next triage step…"
          maxLength={10_000}
          rows={3}
          className="resize-y text-xs"
          aria-label="Issue comment"
        />
        <div className="mt-2 flex items-center justify-between gap-2">
          {commentError == null ? <span className="text-[11px] text-muted-foreground/70">Comments are durable and idempotent.</span> : <span className="text-[11px] text-red-500">{commentError}</span>}
          <DesignButton size="sm" variant="secondary" loading={commentSaving} onClick={submitComment}>Comment</DesignButton>
        </div>
      </div>
    </DesignCard>
  );
}

function OccurrenceNavigation({
  detail,
  occurrence,
  loading,
  nowMs,
  onNavigate,
}: {
  detail: IssueDetailResponse,
  occurrence: IssueOccurrence,
  loading: boolean,
  nowMs: number,
  onNavigate: (cursor: string, direction: IssueOccurrenceDirection) => void,
}) {
  const eventId = getIssueEventPayload(occurrence).eventId;
  return (
    <DesignCard title="Occurrence" subtitle="Retained event navigation" icon={ClockCounterClockwiseIcon}>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="min-w-0">
          <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{eventId == null ? "Occurrence ID" : "Event ID"}</div>
          <div className="mt-1 truncate font-mono text-xs text-foreground" title={eventId ?? occurrence.occurrence_id}>{eventId ?? occurrence.occurrence_id}</div>
        </div>
        {eventId != null && (
          <div className="min-w-0">
            <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Occurrence ID</div>
            <div className="mt-1 truncate font-mono text-xs text-foreground" title={occurrence.occurrence_id}>{occurrence.occurrence_id}</div>
          </div>
        )}
        <div className="min-w-0">
          <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Captured</div>
          <div className="mt-1 text-xs text-foreground" title={formatAbsoluteTimeFromMillis(occurrence.event_at_millis)}>
            {formatRelativeTimeFromMillis(occurrence.event_at_millis, nowMs)}
          </div>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-foreground/[0.06] pt-3">
        <div className="flex items-center gap-2 text-xs text-muted-foreground" aria-live="polite">
          {loading && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-blue-500" />}
          {loading ? "Loading occurrence…" : "Navigate retained occurrences"}
        </div>
        <div className="flex items-center gap-2">
          <DesignButton
            variant="ghost"
            size="sm"
            className="h-7 gap-1 px-2 text-[11px]"
            disabled={loading || detail.older_cursor == null}
            aria-label="Load older occurrence"
            onClick={() => {
              if (detail.older_cursor != null) onNavigate(detail.older_cursor, "older");
            }}
          >
            <ArrowLeftIcon className="h-3.5 w-3.5" />
            Older
          </DesignButton>
          <DesignButton
            variant="ghost"
            size="sm"
            className="h-7 gap-1 px-2 text-[11px]"
            disabled={loading || detail.newer_cursor == null}
            aria-label="Load newer occurrence"
            onClick={() => {
              if (detail.newer_cursor != null) onNavigate(detail.newer_cursor, "newer");
            }}
          >
            Newer
            <ArrowRightIcon className="h-3.5 w-3.5" />
          </DesignButton>
        </div>
      </div>
    </DesignCard>
  );
}

function NoRetainedOccurrence() {
  return (
    <DesignCard title="Occurrence details" subtitle="The event payload is outside retention" icon={ClockCounterClockwiseIcon}>
      <EmptySection
        title="No retained occurrence"
        description="Every occurrence of this issue has aged out of the retention window. The issue aggregate remains available, but exception, request, tag, context, and breadcrumb details cannot be loaded."
      />
    </DesignCard>
  );
}

export function IssueEventSections({
  issue,
  occurrence,
  detail,
  loading,
  nowMs,
  frameOrder,
  onNavigate,
  onPriorityChange,
  onAddComment,
  currentUserId,
  teams,
  actionLoading,
  onAssignmentChange,
  onTeamChange,
  onOwnerChange,
  onBookmarkChange,
  onSubscriptionChange,
}: {
  issue: IssueListItem,
  occurrence: IssueOccurrence | null,
  detail: IssueDetailResponse,
  loading: boolean,
  nowMs: number,
  frameOrder: StackFrameOrder,
  onNavigate: (cursor: string, direction: IssueOccurrenceDirection) => void,
  onPriorityChange: (priority: IssuePriority | null) => Promise<void>,
  onAddComment: (body: string) => Promise<void>,
  currentUserId: string,
  teams: readonly IssueTeamOption[],
  actionLoading: boolean,
  onAssignmentChange: (userId: string | null) => Promise<void>,
  onTeamChange: (teamId: string | null) => Promise<void>,
  onOwnerChange: (type: "user" | "team", id: string) => Promise<void>,
  onBookmarkChange: (bookmarked: boolean) => Promise<void>,
  onSubscriptionChange: (subscribed: boolean) => Promise<void>,
}) {
  return (
    <div className="flex min-w-0 flex-col gap-3">
      {occurrence == null ? <NoRetainedOccurrence /> : (
        <>
          <OccurrenceNavigation detail={detail} occurrence={occurrence} loading={loading} nowMs={nowMs} onNavigate={onNavigate} />
          <ExceptionChainSection issue={issue} occurrence={occurrence} frameOrder={frameOrder} />
          <RequestContextSection occurrence={occurrence} />
          <TagsSection occurrence={occurrence} />
          <ContextsSection occurrence={occurrence} />
          <BreadcrumbsSection occurrence={occurrence} nowMs={nowMs} />
          <AttachmentsSection occurrence={occurrence} />
          <AdditionalEventDataSection occurrence={occurrence} />
        </>
      )}
      <GroupingSection issue={issue} occurrence={occurrence} />
      <IssueReleaseContextSection context={detail.release_context} />
      <IssueProductSection
        detail={detail}
        onPriorityChange={onPriorityChange}
        onAddComment={onAddComment}
        currentUserId={currentUserId}
        teams={teams}
        actionLoading={actionLoading}
        onAssignmentChange={onAssignmentChange}
        onTeamChange={onTeamChange}
        onOwnerChange={onOwnerChange}
        onBookmarkChange={onBookmarkChange}
        onSubscriptionChange={onSubscriptionChange}
      />
    </div>
  );
}
