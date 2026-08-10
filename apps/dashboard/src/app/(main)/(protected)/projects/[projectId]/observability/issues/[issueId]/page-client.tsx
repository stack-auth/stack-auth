"use client";

import { Link } from "@/components/link";
import {
  DesignAlert,
  DesignBadge,
  DesignButton,
  DesignCard,
  DesignMenu,
  DesignPillToggle,
} from "@/components/design-components";
import { cn } from "@/lib/utils";
import { runAsynchronously } from "@hexclave/shared/dist/utils/promises";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  ClockCounterClockwiseIcon,
  LinkIcon,
  ListDashesIcon,
  SpinnerGapIcon,
} from "@phosphor-icons/react";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppEnabledGuard } from "../../../app-enabled-guard";
import { PageLayout } from "../../../page-layout";
import { StickyPageHeader } from "../../../sticky-page-header";
import { useAdminApp } from "../../../use-admin-app";
import { useDashboardInternalUser } from "@/lib/dashboard-user";
import { queryObservability } from "../../filters";
import {
  formatAbsoluteTimeFromMillis,
  formatDateFromMillis,
  formatRelativeTimeFromMillis,
} from "../../format";
import { LogLevelChip } from "../../log-level";
import {
  CORRELATION_ANCHOR_LABELS,
  getLeadingUpToLogsQuery,
  parseLeadingUpToLogRows,
  resolveCorrelationAnchor,
  type LeadingUpToLogLine,
} from "../correlation";
import { formatIssueCount, issueCulprit, issueShortIdLabel, issueSubtitle, issueTitle, parseIssueRouteId } from "../issue-format";
import { issuesListHref, traceDetailHref } from "../issue-links";
import { issueStatusBadge, primaryIssueStatusAction } from "../issue-status";
import {
  fetchIssueDetail,
  addIssueComment,
  setIssueAssignee,
  setIssueBookmarkState,
  setIssueOwnerState,
  setIssueSubscriptionState,
  setIssueTeam,
  updateIssuePriority,
  updateIssueAssignment,
  updateIssueBookmark,
  updateIssueOwner,
  updateIssueSubscription,
  updateIssueTeam,
  updateIssueStatus,
  type IssueDetailResponse,
  type IssueOccurrenceDirection,
  type IssuePriority,
  type IssueStatus,
} from "../issues-data";
import { StackFrameList } from "../stack-frame-list";
import { DEFAULT_STACK_FRAME_ORDER, type StackFrameOrder } from "../stack-frames";
import { IssueEventSections } from "../issue-event-sections";
import { IssueEventGraph } from "../issue-event-graph";

const FRAME_ORDER_OPTIONS = [
  { id: "innermost-first", label: "Newest first" },
  { id: "outermost-first", label: "Oldest first" },
];

function parseFrameOrder(id: string): StackFrameOrder {
  if (id === "innermost-first" || id === "outermost-first") return id;
  throw new Error(`Unknown stack frame order: ${id}`);
}

function StatCell({ label, value, hint }: { label: string, value: string, hint?: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="truncate text-sm tabular-nums text-foreground" title={hint}>{value}</div>
    </div>
  );
}

/**
 * A correlation entry. Renders an em dash instead of disappearing when the
 * value is missing: occurrence navigation swaps every field at once, and a card
 * that changes height on each step makes the page jump under the cursor.
 */
function RailRow({ label, children }: { label: string, children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <span className="shrink-0 text-[11px] text-muted-foreground">{label}</span>
      <span className="min-w-0 truncate text-right text-xs">{children}</span>
    </div>
  );
}

/**
 * `occurrence.data` crosses the wire as `yupMixed()` — it is the customer's own
 * JSON payload, so the contract deliberately doesn't describe its shape. This
 * is the one place it gets narrowed, and anything that isn't a plain object
 * (a stray array or scalar from a hand-rolled ingest call) renders as "no data"
 * rather than crashing the page.
 */
function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value == null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function EmptyRailValue() {
  return <span className="text-muted-foreground/50">—</span>;
}

export default function PageClient() {
  const adminApp = useAdminApp();
  const dashboardUser = useDashboardInternalUser();
  const dashboardTeams = dashboardUser.useTeams();
  const params = useParams<{ issueId: string }>();
  const projectId = adminApp.projectId;
  const rawIssueId = params.issueId;
  const routeId = useMemo(() => parseIssueRouteId(rawIssueId), [rawIssueId]);

  const [detail, setDetail] = useState<IssueDetailResponse | null>(null);
  // The cursor alone is ambiguous — the same `(event_at, occurrence_id)` pair
  // means "the one before" or "the one after" depending on the direction, so
  // both travel together.
  const [occurrenceStep, setOccurrenceStep] = useState<{ cursor: string, direction: IssueOccurrenceDirection } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [productError, setProductError] = useState<string | null>(null);
  const [productSaving, setProductSaving] = useState(false);
  const [frameOrder, setFrameOrder] = useState<StackFrameOrder>(DEFAULT_STACK_FRAME_ORDER);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const [leadingUpTo, setLeadingUpTo] = useState<LeadingUpToLogLine[] | null>(null);
  const [leadingUpToError, setLeadingUpToError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (routeId == null) {
      setLoading(false);
      return () => {};
    }
    let cancelled = false;
    setLoading(true);
    runAsynchronously(async () => {
      try {
        const next = await fetchIssueDetail(
          adminApp,
          routeId.value,
          occurrenceStep == null ? {} : { occurrence: occurrenceStep.cursor, direction: occurrenceStep.direction },
        );
        if (cancelled) return;
        setDetail(next);
        setError(null);
        setNowMs(Date.now());
      } catch (caught) {
        if (cancelled) return;
        setError(caught instanceof Error ? caught.message : String(caught));
      } finally {
        if (!cancelled) setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [adminApp, routeId, occurrenceStep]);

  useEffect(() => load(), [load]);

  const issue = detail?.issue ?? null;
  const occurrence = detail?.occurrence ?? null;
  const anchor = useMemo(
    () => (occurrence == null ? null : resolveCorrelationAnchor(occurrence)),
    [occurrence],
  );

  useEffect(() => {
    if (anchor == null || occurrence == null) {
      setLeadingUpTo([]);
      setLeadingUpToError(null);
      return;
    }
    let cancelled = false;
    setLeadingUpTo(null);
    runAsynchronously(async () => {
      try {
        const { query, params: queryParams } = getLeadingUpToLogsQuery(anchor, occurrence.event_at_millis);
        const response = await queryObservability(adminApp, { query, params: queryParams });
        if (cancelled) return;
        // The query returns newest-first (that's the cheap direction for a
        // LIMIT); the excerpt reads forward in time, ending at the error.
        setLeadingUpTo(parseLeadingUpToLogRows(response.result).reverse());
        setLeadingUpToError(null);
      } catch (caught) {
        if (cancelled) return;
        setLeadingUpToError(caught instanceof Error ? caught.message : String(caught));
        setLeadingUpTo([]);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [adminApp, anchor, occurrence]);

  const changeStatus = useCallback(async (status: IssueStatus) => {
    if (detail == null) return;
    setStatusError(null);
    const previous = detail;
    setDetail({ ...detail, issue: { ...detail.issue, status } });
    try {
      // The endpoint answers with `{ id, status }` only — it does not recompute
      // the window metrics for a status change — so there is nothing else to
      // merge back in.
      await updateIssueStatus(adminApp, detail.issue.id, status);
    } catch (caught) {
      setDetail(previous);
      setStatusError(caught instanceof Error ? caught.message : String(caught));
    }
  }, [adminApp, detail]);

  const changePriority = useCallback(async (priority: IssuePriority | null) => {
    if (detail == null) return;
    const previous = detail.product.priority;
    setProductError(null);
    setDetail({ ...detail, product: { ...detail.product, priority } });
    try {
      await updateIssuePriority(adminApp, detail.issue.id, priority);
    } catch (caught) {
      setDetail({ ...detail, product: { ...detail.product, priority: previous } });
      setProductError(caught instanceof Error ? caught.message : String(caught));
    }
  }, [adminApp, detail]);

  const createComment = useCallback(async (body: string) => {
    if (detail == null) return;
    const result = await addIssueComment(adminApp, detail.issue.id, body, `dashboard-comment-${crypto.randomUUID()}`);
    const createdAt = new Date(result.created_at_millis).toISOString();
    setDetail((current) => current == null ? current : {
      ...current,
      product: {
        ...current.product,
        comments: [{
          id: result.id,
          author_user_id: result.author_user_id,
          body: result.body,
          idempotency_key: result.idempotency_key,
          created_at: createdAt,
          updated_at: createdAt,
        }, ...current.product.comments].slice(0, 100),
      },
    });
  }, [adminApp, detail]);

  const changeAssignment = useCallback(async (assigneeUserId: string | null) => {
    if (detail == null || productSaving) return;
    const previous = detail;
    setProductError(null);
    setProductSaving(true);
    setDetail(setIssueAssignee(detail, assigneeUserId));
    try {
      const result = await updateIssueAssignment(adminApp, detail.issue.id, assigneeUserId);
      setDetail((current) => current == null ? current : setIssueAssignee(current, result.assignee_user_id));
    } catch (caught) {
      setDetail(previous);
      setProductError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setProductSaving(false);
    }
  }, [adminApp, detail, productSaving]);

  const changeTeam = useCallback(async (teamId: string | null) => {
    if (detail == null || productSaving) return;
    const previous = detail;
    setProductError(null);
    setProductSaving(true);
    setDetail(setIssueTeam(detail, teamId));
    try {
      const result = await updateIssueTeam(adminApp, detail.issue.id, teamId);
      setDetail((current) => current == null ? current : setIssueTeam(current, result.team_id));
    } catch (caught) {
      setDetail(previous);
      setProductError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setProductSaving(false);
    }
  }, [adminApp, detail, productSaving]);

  const changeOwner = useCallback(async (type: "user" | "team", id: string) => {
    if (detail == null || productSaving) return;
    const previous = detail;
    setProductError(null);
    setProductSaving(true);
    try {
      const result = await updateIssueOwner(adminApp, detail.issue.id, {
        type,
        userId: type === "user" ? id : null,
        teamId: type === "team" ? id : null,
      });
      const existing = detail.product.owners.find((owner) => owner.id === result.id);
      const updatedAt = new Date(result.updated_at_millis).toISOString();
      setDetail((current) => current == null ? current : setIssueOwnerState(current, {
        id: result.id,
        type: result.type,
        user_id: result.user_id,
        team_id: result.team_id,
        source: result.source,
        context: result.context,
        created_at: existing?.created_at ?? updatedAt,
        updated_at: updatedAt,
      }));
    } catch (caught) {
      setDetail(previous);
      setProductError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setProductSaving(false);
    }
  }, [adminApp, detail, productSaving]);

  const changeBookmark = useCallback(async (bookmarked: boolean) => {
    if (detail == null || productSaving) return;
    const previous = detail;
    setProductError(null);
    setProductSaving(true);
    setDetail(setIssueBookmarkState(detail, dashboardUser.id, bookmarked));
    try {
      const result = await updateIssueBookmark(adminApp, detail.issue.id, dashboardUser.id, bookmarked, `dashboard-bookmark-${crypto.randomUUID()}`);
      setDetail((current) => current == null ? current : setIssueBookmarkState(current, result.user_id, result.bookmarked));
    } catch (caught) {
      setDetail(previous);
      setProductError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setProductSaving(false);
    }
  }, [adminApp, dashboardUser.id, detail, productSaving]);

  const changeSubscription = useCallback(async (subscribed: boolean) => {
    if (detail == null || productSaving) return;
    const previous = detail;
    setProductError(null);
    setProductSaving(true);
    const updatedAt = new Date().toISOString();
    setDetail(setIssueSubscriptionState(detail, { type: "user", id: dashboardUser.id, is_active: subscribed, reason: "manual", created_at: updatedAt, updated_at: updatedAt }, subscribed, updatedAt));
    try {
      const result = await updateIssueSubscription(adminApp, detail.issue.id, "user", dashboardUser.id, subscribed, "manual", `dashboard-subscription-${crypto.randomUUID()}`);
      const existing = detail.product.subscriptions.find((subscription) => subscription.type === result.subject_type && subscription.id === result.subject_id);
      const resultTime = new Date(result.updated_at_millis).toISOString();
      setDetail((current) => current == null ? current : setIssueSubscriptionState(current, {
        type: result.subject_type,
        id: result.subject_id,
        is_active: result.subscribed,
        reason: result.reason,
        created_at: existing?.created_at ?? resultTime,
        updated_at: resultTime,
      }, result.subscribed, resultTime));
    } catch (caught) {
      setDetail(previous);
      setProductError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setProductSaving(false);
    }
  }, [adminApp, dashboardUser.id, detail, productSaving]);

  const teamOptions = useMemo(
    () => dashboardTeams.map((team) => ({ id: team.id, displayName: team.displayName })),
    [dashboardTeams],
  );

  if (routeId == null) {
    return (
      <AppEnabledGuard appId="observability">
        <PageLayout title="Issue" scrollMain>
          <DesignAlert
            variant="error"
            title="Not a valid issue reference"
            description={`"${rawIssueId}" is neither an issue id nor a short id.`}
          >
            <DesignButton variant="secondary" size="sm" className="mt-3" asChild>
              <Link href={issuesListHref(projectId)}>Back to issues</Link>
            </DesignButton>
          </DesignAlert>
        </PageLayout>
      </AppEnabledGuard>
    );
  }

  const title = issue == null ? "Issue" : issueTitle(issue);
  const badge = issue == null ? null : issueStatusBadge(issue);
  const primaryAction = issue == null ? "resolve" : primaryIssueStatusAction(issue.status);

  const headerActions = (
    <div className="flex items-center gap-2">
      {badge != null && <DesignBadge label={badge.label} color={badge.color} size="sm" />}
      {issue != null && (
        <>
          <DesignButton
            variant="secondary"
            size="sm"
            onClick={() => changeStatus(primaryAction === "resolve" ? "resolved" : "unresolved")}
          >
            {primaryAction === "resolve" ? "Resolve" : "Unresolve"}
          </DesignButton>
          <DesignMenu
            variant="actions"
            align="end"
            items={[
              {
                id: "ignore",
                label: issue.status === "ignored" ? "Unignore" : "Ignore",
                onClick: () => changeStatus(issue.status === "ignored" ? "unresolved" : "ignored"),
              },
            ]}
          />
        </>
      )}
    </div>
  );

  return (
    <AppEnabledGuard appId="observability">
      <PageLayout fillWidth scrollMain spacing="compact">
        <StickyPageHeader
          title={title}
          description={
            issue == null
              ? undefined
              : `${issueCulprit({ culprit: issue.culprit, frames: occurrence?.frames, data: asRecord(occurrence?.data) })}${issueSubtitle(issue) === "" ? "" : ` · ${issueSubtitle(issue)}`}`
          }
          actions={headerActions}
          sticky
          layoutGroupId="issue-detail-sticky-header"
          scrollContainer="main"
        />

        {statusError != null && (
          <DesignAlert variant="error" title="Couldn't update this issue" description={statusError} />
        )}

        {productError != null && (
          <DesignAlert variant="error" title="Couldn't update issue triage metadata" description={productError} />
        )}

        {error != null && (
          <DesignAlert variant="error" title="Couldn't load this issue" description={error}>
            <DesignButton variant="secondary" size="sm" className="mt-3" onClick={() => { load(); }}>
              Retry
            </DesignButton>
          </DesignAlert>
        )}

        {loading && detail == null && error == null && (
          <div className="flex items-center justify-center py-24">
            <SpinnerGapIcon className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        )}

        {detail != null && issue != null && (
          <div className="grid min-w-0 gap-3 lg:grid-cols-[minmax(0,1fr)_20rem]">
            <div className="flex min-w-0 flex-col gap-3">
              <DesignCard>
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                  <StatCell
                    label="Events"
                    value={formatIssueCount(issue.window_occurrences)}
                    hint="Occurrences inside the selected range (ClickHouse)"
                  />
                  <StatCell
                    label="Users"
                    value={formatIssueCount(issue.window_users)}
                    hint="Distinct users affected inside the range"
                  />
                  <StatCell
                    label="All time"
                    value={
                      issue.counters_truncated_at_millis == null
                        ? formatIssueCount(issue.times_seen)
                        : `${formatIssueCount(issue.times_seen)} since ${formatDateFromMillis(issue.counters_truncated_at_millis)}`
                    }
                    hint="Lifetime count (Postgres)"
                  />
                  <StatCell
                    label="First seen"
                    value={formatRelativeTimeFromMillis(issue.first_seen_at_millis, nowMs)}
                    hint={formatAbsoluteTimeFromMillis(issue.first_seen_at_millis)}
                  />
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-foreground/[0.06] pt-3">
                  <LogLevelChip level={issue.level} />
                  <DesignBadge label={issue.handled ? "Handled" : "Unhandled"} color={issue.handled ? "zinc" : "red"} size="sm" />
                  {issue.environment != null && <DesignBadge label={issue.environment} color="zinc" size="sm" />}
                  {issue.service_name != null && <DesignBadge label={issue.service_name} color="zinc" size="sm" />}
                  <span className="font-mono text-[11px] text-muted-foreground/70">
                    {issueShortIdLabel(issue.short_id)}
                  </span>
                </div>
              </DesignCard>

              <DesignCard
                title="Stack trace"
                icon={ListDashesIcon}
                subtitle={
                  occurrence == null
                    ? "No retained occurrence"
                    : `${formatAbsoluteTimeFromMillis(occurrence.event_at_millis)} · ${formatRelativeTimeFromMillis(occurrence.event_at_millis, nowMs)}`
                }
                actions={
                  <div className="flex items-center gap-2">
                    <DesignPillToggle
                      selected={frameOrder}
                      onSelect={(id) => setFrameOrder(parseFrameOrder(id))}
                      options={FRAME_ORDER_OPTIONS}
                      size="sm"
                      glassmorphic={false}
                    />
                    {/*
                      No "84 of 1,203" ordinal on purpose: it needs a second
                      count query per navigation, and a stale number is worse
                      than none.
                    */}
                    <DesignButton
                      variant="ghost"
                      size="sm"
                      className="h-7 gap-1 px-2 text-[11px]"
                      disabled={detail.older_cursor == null}
                      onClick={() => setOccurrenceStep(
                        detail.older_cursor == null ? null : { cursor: detail.older_cursor, direction: "older" },
                      )}
                    >
                      <ArrowLeftIcon className="h-3.5 w-3.5" />
                      Older
                    </DesignButton>
                    <DesignButton
                      variant="ghost"
                      size="sm"
                      className="h-7 gap-1 px-2 text-[11px]"
                      disabled={detail.newer_cursor == null}
                      onClick={() => setOccurrenceStep(
                        detail.newer_cursor == null ? null : { cursor: detail.newer_cursor, direction: "newer" },
                      )}
                    >
                      Newer
                      <ArrowRightIcon className="h-3.5 w-3.5" />
                    </DesignButton>
                  </div>
                }
              >
                {occurrence == null ? (
                  <DesignAlert
                    variant="info"
                    title="No retained occurrence"
                    description="Every occurrence of this issue has aged out of the retention window. The issue's counters are still exact."
                  />
                ) : (
                  <StackFrameList
                    frames={occurrence.frames}
                    rawStack={occurrence.raw_stack}
                    order={frameOrder}
                  />
                )}
              </DesignCard>

              <IssueEventGraph
                projectId={projectId}
                issue={issue}
                occurrence={occurrence}
                leadingUpToCount={leadingUpTo?.length ?? 0}
              />

              <IssueEventSections
                issue={issue}
                occurrence={occurrence}
                detail={detail}
                loading={loading}
                nowMs={nowMs}
                frameOrder={frameOrder}
                onNavigate={(cursor, direction) => setOccurrenceStep({ cursor, direction })}
                onPriorityChange={changePriority}
                onAddComment={createComment}
                currentUserId={dashboardUser.id}
                teams={teamOptions}
                actionLoading={productSaving}
                onAssignmentChange={changeAssignment}
                onTeamChange={changeTeam}
                onOwnerChange={changeOwner}
                onBookmarkChange={changeBookmark}
                onSubscriptionChange={changeSubscription}
              />
            </div>

            <aside className="min-w-0 lg:sticky lg:top-3 lg:self-start">
              <DesignCard title="Correlated" icon={LinkIcon}>
                <div className="divide-y divide-foreground/[0.06]">
                  <RailRow label="Trace">
                    {occurrence?.trace_id == null ? <EmptyRailValue /> : (
                      <Link
                        className="font-mono text-xs hover:underline"
                        href={traceDetailHref(projectId, occurrence.trace_id)}
                      >
                        {occurrence.trace_id.slice(0, 12)}…
                      </Link>
                    )}
                  </RailRow>
                  <RailRow label="Session replay">
                    {occurrence?.session_replay_id == null ? <EmptyRailValue /> : (
                      <Link
                        className="font-mono text-xs hover:underline"
                        href={`/projects/${encodeURIComponent(projectId)}/session-replays/${encodeURIComponent(occurrence.session_replay_id)}`}
                      >
                        Watch replay
                      </Link>
                    )}
                  </RailRow>
                  <RailRow label="User">
                    {occurrence?.user_id == null ? <EmptyRailValue /> : (
                      <Link
                        className="font-mono text-xs hover:underline"
                        href={`/projects/${encodeURIComponent(projectId)}/users/${encodeURIComponent(occurrence.user_id)}`}
                      >
                        {occurrence.user_id.slice(0, 12)}…
                      </Link>
                    )}
                  </RailRow>
                  <RailRow label="Release">
                    {issue.release == null ? <EmptyRailValue /> : <span className="font-mono text-xs">{issue.release}</span>}
                  </RailRow>
                </div>
              </DesignCard>

              <DesignCard
                title="Leading up to this"
                icon={ClockCounterClockwiseIcon}
                subtitle={anchor == null ? "No correlation id" : CORRELATION_ANCHOR_LABELS.get(anchor.kind)}
                className="mt-3"
              >
                {leadingUpToError != null && (
                  <DesignAlert variant="warning" title="Couldn't load logs" description={leadingUpToError} />
                )}
                {leadingUpToError == null && leadingUpTo == null && (
                  <div className="flex items-center justify-center py-6">
                    <SpinnerGapIcon className="h-4 w-4 animate-spin text-muted-foreground" />
                  </div>
                )}
                {leadingUpToError == null && leadingUpTo != null && leadingUpTo.length === 0 && (
                  <div className="py-2 text-xs text-muted-foreground/70">
                    {anchor == null
                      ? "This occurrence carries no trace, page view, or session id to correlate on."
                      : "No log lines in the five minutes before this error."}
                  </div>
                )}
                {leadingUpToError == null && leadingUpTo != null && leadingUpTo.length > 0 && (
                  <ol className="max-h-80 space-y-1.5 overflow-y-auto">
                    {leadingUpTo.map((line, index) => (
                      <li key={`${line.eventAtMillis}-${index}`} className={cn("flex min-w-0 items-baseline gap-2")}>
                        <span className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground/60">
                          {formatAbsoluteTimeFromMillis(line.eventAtMillis)}
                        </span>
                        <LogLevelChip level={line.level} />
                        <span className="min-w-0 truncate font-mono text-[11px]" title={line.message}>
                          {line.message}
                        </span>
                      </li>
                    ))}
                  </ol>
                )}
              </DesignCard>
            </aside>
          </div>
        )}
      </PageLayout>
    </AppEnabledGuard>
  );
}
