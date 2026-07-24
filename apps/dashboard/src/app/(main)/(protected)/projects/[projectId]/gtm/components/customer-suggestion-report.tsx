"use client";

import {
  DesignAlert,
  DesignBadge,
  DesignButton,
  DesignDialog,
  DesignInput,
  DesignSelectorDropdown,
} from "@/components/design-components";
import { Link } from "@/components/link";
import { useRouterConfirm } from "@/components/router";
import { Textarea } from "@/components/ui";
import { PageLayout } from "../../page-layout";
import { useProjectId } from "../../use-admin-app";
import { useGtmData } from "@/lib/gtm/gtm-data";
import { updateAction, updateInsight } from "@/lib/gtm/gtm-api";
import {
  actionTypeLabel,
  GTM_ACTION_STATUSES,
  GTM_CONFIDENCES,
  GTM_INSIGHT_KINDS,
  GTM_INSIGHT_STATUSES,
  type GtmAction,
  type GtmInsight,
} from "@/lib/gtm/gtm-types";
import { urlString } from "@hexclave/shared/dist/utils/urls";
import { ArrowLeftIcon, PencilSimpleIcon } from "@phosphor-icons/react";
import { useStackApp } from "@hexclave/next";
import { useEffect, useState } from "react";
import { GtmLoadableSection, GtmSectionSkeleton } from "./shared";

type Suggestion =
  | { type: "insight", value: GtmInsight }
  | { type: "action", value: GtmAction };

function formatDateTime(millis: number): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(millis);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function toDateTimeLocal(millis: number | null): string {
  if (millis == null) return "";
  const date = new Date(millis);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function fromDateTimeLocal(value: string): number | null {
  return value.length === 0 ? null : new Date(value).getTime();
}

function selectorOptions(values: readonly string[]) {
  return values.map((value) => ({ value, label: value.replaceAll("_", " ") }));
}

function requireSelectorValue<const Value extends string>(values: readonly Value[], value: string, field: string): Value {
  const selected = values.find((candidate) => candidate === value);
  if (selected == null) throw new Error(`The timeline ${field} selector returned an unknown value: ${value}`);
  return selected;
}

function TimelineEntry(props: { label: string, title: string, date: number, children: React.ReactNode }) {
  return (
    <li className="relative pl-8">
      <span className="absolute left-0 top-1.5 h-[0.7rem] w-[0.7rem] rounded-full border-2 border-background bg-foreground" aria-hidden="true" />
      <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground">{props.label}</p>
      <div className="mt-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-base font-semibold text-foreground">{props.title}</h2>
        <time className="font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground">{formatDateTime(props.date)}</time>
      </div>
      <div className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">{props.children}</div>
    </li>
  );
}

function InsightTimeline(props: { insight: GtmInsight }) {
  const insight = props.insight;
  return (
    <ol className="relative space-y-9 before:absolute before:bottom-3 before:left-[0.31rem] before:top-3 before:w-px before:bg-foreground/[0.14]">
      <TimelineEntry label="Recorded" title="A growth signal was added" date={insight.createdAtMillis}>
        This {insight.kind.replaceAll("_", " ")} was recorded with {insight.confidence} confidence and an impact score of {insight.impactScore}/100.
      </TimelineEntry>
      <TimelineEntry label="Confirmed" title={insight.timesSeen === 1 ? "The signal was reviewed" : "The pattern was seen again"} date={insight.lastSeenAtMillis}>
        {insight.timesSeen === 1
          ? "This is the first recorded observation for this signal."
          : `This pattern has been recorded ${insight.timesSeen} times.`}
      </TimelineEntry>
      <TimelineEntry label="Current state" title={insight.status.replaceAll("_", " ")} date={insight.updatedAtMillis}>
        Our growth team will use this record to guide the next conversation about your project.
      </TimelineEntry>
    </ol>
  );
}

function ActionTimeline(props: { action: GtmAction }) {
  const action = props.action;
  const outcomeDate = action.executedAtMillis ?? action.updatedAtMillis;
  return (
    <ol className="relative space-y-9 before:absolute before:bottom-3 before:left-[0.31rem] before:top-3 before:w-px before:bg-foreground/[0.14]">
      <TimelineEntry label="Recommendation" title="A next step was recorded" date={action.createdAtMillis}>
        {action.summary}
      </TimelineEntry>
      <TimelineEntry label="Review window" title="The recommendation remains available" date={action.expiresAtMillis}>
        This recorded recommendation remains available until the review window ends. It does not execute an external action.
      </TimelineEntry>
      <TimelineEntry label="Current state" title={action.status.replaceAll("_", " ")} date={outcomeDate}>
        {action.retrospective ?? "Our growth team will update this record as the recommendation is reviewed."}
      </TimelineEntry>
    </ol>
  );
}

function TimelineField(props: { label: string, children: React.ReactNode }) {
  return (
    <label className="space-y-1.5">
      <span className="block text-xs font-medium text-muted-foreground">{props.label}</span>
      {props.children}
    </label>
  );
}

function InsightTimelineEditor(props: {
  insight: GtmInsight,
  targetProjectId: string,
  onSaved: () => Promise<void>,
  onDirtyChange: (dirty: boolean) => void,
}) {
  const app = useStackApp();
  const { onDirtyChange } = props;
  const [draft, setDraft] = useState(() => ({
    kind: props.insight.kind,
    confidence: props.insight.confidence,
    impactScore: props.insight.impactScore,
    timesSeen: props.insight.timesSeen,
    status: props.insight.status,
  }));
  const [error, setError] = useState<string | null>(null);
  const dirty = JSON.stringify(draft) !== JSON.stringify({
    kind: props.insight.kind,
    confidence: props.insight.confidence,
    impactScore: props.insight.impactScore,
    timesSeen: props.insight.timesSeen,
    status: props.insight.status,
  });

  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);

  const save = async () => {
    setError(null);
    try {
      await updateInsight(app, { ...props.insight, ...draft }, props.targetProjectId);
      onDirtyChange(false);
      await props.onSaved();
    } catch (saveError) {
      setError(errorMessage(saveError));
    }
  };

  return (
    <div className="space-y-4">
      <DesignAlert
        variant="info"
        title="Audit dates stay trustworthy"
        description="Saving updates the confirmed and current-state dates automatically. The original recorded date is never rewritten."
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <TimelineField label="Signal kind">
          <DesignSelectorDropdown
            value={draft.kind}
            options={selectorOptions(GTM_INSIGHT_KINDS)}
            onValueChange={(value) => setDraft({
              ...draft,
              kind: requireSelectorValue(GTM_INSIGHT_KINDS, value, "kind"),
            })}
          />
        </TimelineField>
        <TimelineField label="Confidence">
          <DesignSelectorDropdown
            value={draft.confidence}
            options={selectorOptions(GTM_CONFIDENCES)}
            onValueChange={(value) => setDraft({
              ...draft,
              confidence: requireSelectorValue(GTM_CONFIDENCES, value, "confidence"),
            })}
          />
        </TimelineField>
        <TimelineField label="Impact score">
          <DesignInput
            type="number"
            min={0}
            max={100}
            value={draft.impactScore}
            onChange={(event) => setDraft({ ...draft, impactScore: Number(event.target.value) })}
          />
        </TimelineField>
        <TimelineField label="Times seen">
          <DesignInput
            type="number"
            min={1}
            value={draft.timesSeen}
            onChange={(event) => setDraft({ ...draft, timesSeen: Number(event.target.value) })}
          />
        </TimelineField>
        <TimelineField label="Current state">
          <DesignSelectorDropdown
            value={draft.status}
            options={selectorOptions(GTM_INSIGHT_STATUSES)}
            onValueChange={(value) => setDraft({
              ...draft,
              status: requireSelectorValue(GTM_INSIGHT_STATUSES, value, "status"),
            })}
          />
        </TimelineField>
      </div>
      {error != null && <DesignAlert variant="error" title="Could not update timeline" description={error} />}
      <DesignButton onClick={save}>Save timeline</DesignButton>
    </div>
  );
}

function ActionTimelineEditor(props: {
  action: GtmAction,
  targetProjectId: string,
  onSaved: () => Promise<void>,
  onDirtyChange: (dirty: boolean) => void,
}) {
  const app = useStackApp();
  const { onDirtyChange } = props;
  const [draft, setDraft] = useState(() => ({
    summary: props.action.summary,
    expiresAtMillis: props.action.expiresAtMillis,
    status: props.action.status,
    executedAtMillis: props.action.executedAtMillis,
    retrospective: props.action.retrospective,
  }));
  const [error, setError] = useState<string | null>(null);
  const dirty = JSON.stringify(draft) !== JSON.stringify({
    summary: props.action.summary,
    expiresAtMillis: props.action.expiresAtMillis,
    status: props.action.status,
    executedAtMillis: props.action.executedAtMillis,
    retrospective: props.action.retrospective,
  });

  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);

  const save = async () => {
    setError(null);
    try {
      await updateAction(app, { ...props.action, ...draft }, props.targetProjectId);
      onDirtyChange(false);
      await props.onSaved();
    } catch (saveError) {
      setError(errorMessage(saveError));
    }
  };

  return (
    <div className="space-y-4">
      <DesignAlert
        variant="info"
        title="This only edits the record"
        description="Saving timeline details never sends email, changes project configuration, or performs an external action."
      />
      <TimelineField label="Recommendation">
        <Textarea
          value={draft.summary}
          maxLength={2000}
          onChange={(event) => setDraft({ ...draft, summary: event.target.value })}
          className="min-h-24"
        />
      </TimelineField>
      <div className="grid gap-3 sm:grid-cols-2">
        <TimelineField label="Review window ends">
          <DesignInput
            type="datetime-local"
            value={toDateTimeLocal(draft.expiresAtMillis)}
            onChange={(event) => {
              const expiresAtMillis = fromDateTimeLocal(event.target.value);
              if (expiresAtMillis == null) return;
              setDraft({ ...draft, expiresAtMillis });
            }}
          />
        </TimelineField>
        <TimelineField label="Current state">
          <DesignSelectorDropdown
            value={draft.status}
            options={selectorOptions(GTM_ACTION_STATUSES)}
            onValueChange={(value) => setDraft({
              ...draft,
              status: requireSelectorValue(GTM_ACTION_STATUSES, value, "status"),
            })}
          />
        </TimelineField>
        <TimelineField label="Outcome date">
          <DesignInput
            type="datetime-local"
            value={toDateTimeLocal(draft.executedAtMillis)}
            onChange={(event) => setDraft({
              ...draft,
              executedAtMillis: fromDateTimeLocal(event.target.value),
            })}
          />
        </TimelineField>
      </div>
      <TimelineField label="Current-state note">
        <Textarea
          value={draft.retrospective ?? ""}
          maxLength={5000}
          onChange={(event) => setDraft({
            ...draft,
            retrospective: event.target.value.length === 0 ? null : event.target.value,
          })}
          className="min-h-24"
          placeholder="Optional retrospective"
        />
      </TimelineField>
      {error != null && <DesignAlert variant="error" title="Could not update timeline" description={error} />}
      <DesignButton onClick={save}>Save timeline</DesignButton>
    </div>
  );
}

function TimelineEditorDialog(props: {
  suggestion: Suggestion,
  targetProjectId: string,
  open: boolean,
  onOpenChange: (open: boolean) => void,
}) {
  const { refresh } = useGtmData();
  const { setNeedConfirm } = useRouterConfirm();
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setNeedConfirm(props.open && dirty);
    return () => setNeedConfirm(false);
  }, [dirty, props.open, setNeedConfirm]);

  const setOpen = (open: boolean) => {
    if (!open && dirty && !window.confirm("Discard the unsaved timeline changes?")) return;
    if (!open) setDirty(false);
    props.onOpenChange(open);
  };
  const saved = async () => {
    setDirty(false);
    props.onOpenChange(false);
    await refresh();
  };

  return (
    <DesignDialog
      open={props.open}
      onOpenChange={setOpen}
      size="lg"
      title="Edit timeline"
      description="Update the fields represented in this suggestion’s timeline."
    >
      {props.open && (props.suggestion.type === "insight"
        ? (
          <InsightTimelineEditor
            key={props.suggestion.value.updatedAtMillis}
            insight={props.suggestion.value}
            targetProjectId={props.targetProjectId}
            onSaved={saved}
            onDirtyChange={setDirty}
          />
        )
        : (
          <ActionTimelineEditor
            key={props.suggestion.value.updatedAtMillis}
            action={props.suggestion.value}
            targetProjectId={props.targetProjectId}
            onSaved={saved}
            onDirtyChange={setDirty}
          />
        ))}
    </DesignDialog>
  );
}

function SuggestionReport(props: { suggestion: Suggestion, adminTargetProjectId?: string }) {
  const { demo } = useGtmData();
  const projectId = useProjectId();
  const suggestion = props.suggestion;
  const [editorOpen, setEditorOpen] = useState(false);
  const returnHref = props.adminTargetProjectId == null
    ? urlString`/projects/${projectId}/gtm?demo=${demo ? "true" : "false"}`
    : urlString`/projects/internal/gtm/admin?project_id=${props.adminTargetProjectId}`;

  return (
    <PageLayout width={1100} allowContentOverflow>
      <div className="mx-auto flex w-full max-w-4xl items-center justify-between gap-3">
        <Link href={returnHref}>
          <DesignButton size="sm" variant="plain">
            <ArrowLeftIcon className="mr-1.5 h-3.5 w-3.5" />
            {props.adminTargetProjectId == null ? "Back to GTM" : "Back to GTM admin"}
          </DesignButton>
        </Link>
        {props.adminTargetProjectId != null && (
          <DesignButton size="sm" variant="outline" onClick={() => setEditorOpen(true)}>
            <PencilSimpleIcon className="mr-1.5 h-3.5 w-3.5" />
            Edit timeline
          </DesignButton>
        )}
      </div>
      <article className="mx-auto w-full max-w-4xl rounded-2xl border border-foreground/[0.08] bg-background p-5 sm:p-8">
        <header className="border-b border-foreground/[0.09] pb-8">
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
            {suggestion.type === "insight" ? "Growth signal" : "Growth recommendation"} · {formatDateTime(suggestion.value.createdAtMillis)}
          </p>
          <h1 className="mt-4 max-w-3xl text-balance font-serif text-4xl leading-[1.02] tracking-tight text-foreground sm:text-5xl">{suggestion.value.title}</h1>
          <p className="mt-4 max-w-3xl text-pretty text-base leading-7 text-muted-foreground">
            {suggestion.type === "insight" ? suggestion.value.body : suggestion.value.summary}
          </p>
          <div className="mt-5 flex flex-wrap items-center gap-2">
            {suggestion.type === "insight" ? (
              <>
                <DesignBadge label={suggestion.value.kind.replaceAll("_", " ")} color="cyan" size="sm" />
                <DesignBadge label={`${suggestion.value.confidence} confidence`} color={suggestion.value.confidence === "high" ? "green" : suggestion.value.confidence === "medium" ? "blue" : "orange"} size="sm" />
                <DesignBadge label={suggestion.value.status.replaceAll("_", " ")} color="purple" size="sm" />
              </>
            ) : (
              <>
                <DesignBadge label={actionTypeLabel(suggestion.value.type)} color="cyan" size="sm" />
                <DesignBadge label={suggestion.value.status.replaceAll("_", " ")} color="blue" size="sm" />
                <DesignBadge label={props.adminTargetProjectId == null ? "Read only" : "Timeline editable"} color={props.adminTargetProjectId == null ? "orange" : "green"} size="sm" />
              </>
            )}
          </div>
        </header>
        <section className="pt-8" aria-labelledby="suggestion-timeline-heading">
          <h2 id="suggestion-timeline-heading" className="font-serif text-3xl tracking-tight">Timeline</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
            The history currently recorded for this suggestion.
          </p>
          <div className="mt-8">
            {suggestion.type === "insight"
              ? <InsightTimeline insight={suggestion.value} />
              : <ActionTimeline action={suggestion.value} />}
          </div>
        </section>
      </article>
      {props.adminTargetProjectId != null && (
        <TimelineEditorDialog
          suggestion={suggestion}
          targetProjectId={props.adminTargetProjectId}
          open={editorOpen}
          onOpenChange={setEditorOpen}
        />
      )}
    </PageLayout>
  );
}

export function CustomerSuggestionReport(props: { id: string, type: Suggestion["type"], adminTargetProjectId?: string }) {
  const { data } = useGtmData();
  return (
    <GtmLoadableSection data={data}>
      {(dataset) => {
        if (props.type === "insight") {
          const insight = dataset.insights.find((candidate) => candidate.id === props.id);
          if (insight != null) return <SuggestionReport suggestion={{ type: "insight", value: insight }} adminTargetProjectId={props.adminTargetProjectId} />;
        } else {
          const action = dataset.actions.find((candidate) => candidate.id === props.id);
          if (action != null) return <SuggestionReport suggestion={{ type: "action", value: action }} adminTargetProjectId={props.adminTargetProjectId} />;
        }
        return (
          <PageLayout width={1100}>
            <DesignAlert
              variant="error"
              title="Suggestion not found"
              description="This suggestion no longer exists. Return to GTM to see the current workspace."
            />
          </PageLayout>
        );
      }}
    </GtmLoadableSection>
  );
}
