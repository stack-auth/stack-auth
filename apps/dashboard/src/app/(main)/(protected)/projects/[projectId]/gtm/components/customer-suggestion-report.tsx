"use client";

import {
  DesignAlert,
  DesignBadge,
  DesignButton,
  DesignDialog,
  DesignInput,
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
  type GtmAction,
  type GtmInsight,
  type GtmTimelineEntry,
} from "@/lib/gtm/gtm-types";
import { urlString } from "@hexclave/shared/dist/utils/urls";
import { ArrowDownIcon, ArrowLeftIcon, ArrowUpIcon, PencilSimpleIcon, PlusIcon, TrashIcon } from "@phosphor-icons/react";
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

const TIMELINE_LIST_CLASS = "relative space-y-9 before:absolute before:bottom-3 before:left-[0.31rem] before:top-3 before:w-px before:bg-foreground/[0.14]";

/**
 * A suggestion's timeline is exactly what someone wrote into it — never anything derived from the record's
 * other fields. Deriving entries was tried and removed: it put sentences on the customer's page that nobody
 * on the growth team had written or reviewed, which read as history rather than as the boilerplate it was.
 *
 * `null` (nobody has touched the timeline) and `[]` (someone curated it down to nothing) therefore show the
 * same empty state; the column keeps both because the API and stored rows distinguish them.
 */
function suggestionTimeline(suggestion: Suggestion): GtmTimelineEntry[] {
  return suggestion.value.timeline ?? [];
}

function SuggestionTimeline(props: { suggestion: Suggestion }) {
  const entries = suggestionTimeline(props.suggestion);
  if (entries.length === 0) {
    return <p className="text-sm leading-6 text-muted-foreground">No timeline entries yet.</p>;
  }
  return (
    <ol className={TIMELINE_LIST_CLASS}>
      {entries.map((entry, index) => (
        <TimelineEntry key={index} label={entry.label} title={entry.title} date={entry.dateMillis}>
          {entry.body}
        </TimelineEntry>
      ))}
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

const TIMELINE_LABEL_MAX_LENGTH = 40;
const TIMELINE_TITLE_MAX_LENGTH = 200;
const TIMELINE_BODY_MAX_LENGTH = 2000;
const TIMELINE_MAX_ENTRIES = 40;

function entryValidationError(entries: GtmTimelineEntry[]): string | null {
  if (entries.length > TIMELINE_MAX_ENTRIES) return `A timeline can hold at most ${TIMELINE_MAX_ENTRIES} entries.`;
  const invalid = entries.findIndex((entry) => entry.label.trim().length === 0 || entry.title.trim().length === 0);
  if (invalid >= 0) return `Entry ${invalid + 1} needs both a label and a headline.`;
  const undated = entries.findIndex((entry) => !Number.isFinite(entry.dateMillis));
  if (undated >= 0) return `Entry ${undated + 1} needs a date.`;
  return null;
}

function TimelineEntryEditor(props: {
  entry: GtmTimelineEntry,
  index: number,
  count: number,
  onChange: (entry: GtmTimelineEntry) => void,
  onMove: (direction: -1 | 1) => void,
  onRemove: () => void,
}) {
  const { entry, index, count } = props;
  return (
    <li className="rounded-lg border border-foreground/[0.09] bg-background p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground">Entry {index + 1}</span>
        <div className="flex items-center gap-1">
          <DesignButton
            size="icon"
            variant="plain"
            aria-label={`Move entry ${index + 1} earlier`}
            disabled={index === 0}
            onClick={() => props.onMove(-1)}
          >
            <ArrowUpIcon className="h-3.5 w-3.5" />
          </DesignButton>
          <DesignButton
            size="icon"
            variant="plain"
            aria-label={`Move entry ${index + 1} later`}
            disabled={index === count - 1}
            onClick={() => props.onMove(1)}
          >
            <ArrowDownIcon className="h-3.5 w-3.5" />
          </DesignButton>
          <DesignButton
            size="icon"
            variant="plain"
            aria-label={`Remove entry ${index + 1}`}
            onClick={props.onRemove}
          >
            <TrashIcon className="h-3.5 w-3.5" />
          </DesignButton>
        </div>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <TimelineField label="Label">
          <DesignInput
            value={entry.label}
            maxLength={TIMELINE_LABEL_MAX_LENGTH}
            placeholder="Recorded"
            onChange={(event) => props.onChange({ ...entry, label: event.target.value })}
          />
        </TimelineField>
        <TimelineField label="Date">
          <DesignInput
            type="datetime-local"
            value={toDateTimeLocal(entry.dateMillis)}
            onChange={(event) => {
              const dateMillis = fromDateTimeLocal(event.target.value);
              // An empty or half-typed datetime input yields null; keep the previous instant rather than
              // writing NaN into the draft, which would fail validation for a value the admin never chose.
              if (dateMillis == null) return;
              props.onChange({ ...entry, dateMillis });
            }}
          />
        </TimelineField>
      </div>
      <div className="mt-3 space-y-3">
        <TimelineField label="Headline">
          <DesignInput
            value={entry.title}
            maxLength={TIMELINE_TITLE_MAX_LENGTH}
            placeholder="A growth signal was added"
            onChange={(event) => props.onChange({ ...entry, title: event.target.value })}
          />
        </TimelineField>
        <TimelineField label="Body">
          <Textarea
            value={entry.body}
            maxLength={TIMELINE_BODY_MAX_LENGTH}
            className="min-h-20"
            placeholder="What happened, in the words you want the customer to read."
            onChange={(event) => props.onChange({ ...entry, body: event.target.value })}
          />
        </TimelineField>
      </div>
    </li>
  );
}

/**
 * Edits the timeline as free text. A suggestion nobody has curated opens empty, which is also what the
 * customer sees — the editor never seeds entries the growth team did not write.
 */
function SuggestionTimelineEditor(props: {
  suggestion: Suggestion,
  targetProjectId: string,
  onSaved: () => Promise<void>,
  onDirtyChange: (dirty: boolean) => void,
}) {
  const app = useStackApp();
  const { onDirtyChange } = props;
  const stored = props.suggestion.value.timeline;
  const [entries, setEntries] = useState<GtmTimelineEntry[]>(() => suggestionTimeline(props.suggestion));
  const [error, setError] = useState<string | null>(null);
  // Compare against the same `?? []` view the draft was seeded from, so an untouched editor is never dirty
  // — an uncurated suggestion and one curated down to nothing both start as an empty list.
  const dirty = JSON.stringify(entries) !== JSON.stringify(stored ?? []);

  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);

  const validationError = entryValidationError(entries);

  const updateEntry = (index: number, entry: GtmTimelineEntry) => {
    setEntries(entries.map((current, currentIndex) => currentIndex === index ? entry : current));
  };
  const moveEntry = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= entries.length) return;
    const reordered = [...entries];
    const [moved] = reordered.splice(index, 1);
    reordered.splice(target, 0, moved);
    setEntries(reordered);
  };
  const addEntry = () => {
    // New entries land at the end dated now — the common case is appending what just happened.
    setEntries([...entries, { label: "Update", title: "", body: "", dateMillis: Date.now() }]);
  };

  const save = async () => {
    setError(null);
    if (validationError != null) {
      setError(validationError);
      return;
    }
    const trimmed = entries.map((entry) => ({ ...entry, label: entry.label.trim(), title: entry.title.trim(), body: entry.body.trim() }));
    try {
      if (props.suggestion.type === "insight") {
        await updateInsight(app, { ...props.suggestion.value, timeline: trimmed }, props.targetProjectId);
      } else {
        await updateAction(app, { ...props.suggestion.value, timeline: trimmed }, props.targetProjectId);
      }
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
        description="Everything here is the text the customer reads on the suggestion page. Saving never sends email, changes project configuration, or performs an external action."
      />
      {entries.length === 0
        ? (
          <p className="rounded-lg border border-dashed border-foreground/[0.14] p-4 text-sm text-muted-foreground">
            This timeline is empty. The customer sees a short note saying there are no entries yet.
          </p>
        )
        : (
          <ol className="space-y-3">
            {entries.map((entry, index) => (
              <TimelineEntryEditor
                key={index}
                entry={entry}
                index={index}
                count={entries.length}
                onChange={(updated) => updateEntry(index, updated)}
                onMove={(direction) => moveEntry(index, direction)}
                onRemove={() => setEntries(entries.filter((_, currentIndex) => currentIndex !== index))}
              />
            ))}
          </ol>
        )}
      <DesignButton variant="outline" size="sm" onClick={addEntry} disabled={entries.length >= TIMELINE_MAX_ENTRIES}>
        <PlusIcon className="mr-1.5 h-3.5 w-3.5" />
        Add entry
      </DesignButton>
      {validationError != null && <DesignAlert variant="warning" title="Not ready to save" description={validationError} />}
      {error != null && <DesignAlert variant="error" title="Could not update timeline" description={error} />}
      <div className="flex flex-wrap items-center gap-2">
        <DesignButton onClick={save} disabled={validationError != null}>Save timeline</DesignButton>
      </div>
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
      description="Write the entries exactly as the customer should read them."
    >
      {props.open && (
        <SuggestionTimelineEditor
          key={props.suggestion.value.updatedAtMillis}
          suggestion={props.suggestion}
          targetProjectId={props.targetProjectId}
          onSaved={saved}
          onDirtyChange={setDirty}
        />
      )}
    </DesignDialog>
  );
}

function SuggestionReport(props: { suggestion: Suggestion, adminTargetProjectId?: string }) {
  const projectId = useProjectId();
  const suggestion = props.suggestion;
  const [editorOpen, setEditorOpen] = useState(false);
  const returnHref = props.adminTargetProjectId == null
    ? urlString`/projects/${projectId}/gtm`
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
          {suggestion.type === "action" && (
            <div className="mt-5 flex flex-wrap items-center gap-2">
              <DesignBadge label={actionTypeLabel(suggestion.value.type)} color="cyan" size="sm" />
              <DesignBadge label={suggestion.value.status.replaceAll("_", " ")} color="blue" size="sm" />
              <DesignBadge label={props.adminTargetProjectId == null ? "Read only" : "Timeline editable"} color={props.adminTargetProjectId == null ? "orange" : "green"} size="sm" />
            </div>
          )}
        </header>
        <section className="pt-8" aria-labelledby="suggestion-timeline-heading">
          <h2 id="suggestion-timeline-heading" className="font-serif text-3xl tracking-tight">Timeline</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
            The history currently recorded for this suggestion.
          </p>
          <div className="mt-8">
            <SuggestionTimeline suggestion={suggestion} />
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
