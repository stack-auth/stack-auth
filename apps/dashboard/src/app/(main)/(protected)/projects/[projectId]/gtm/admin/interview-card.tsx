"use client";

import { DesignAlert, DesignBadge, DesignButton, DesignCard } from "@/components/design-components";
import { formatGrowthRelativeTime } from "@/lib/growth/growth-format";
import {
  deleteGrowthAdminInterviewQuestion,
  getGrowthAdminInterview,
  regenerateGrowthAdminInterview,
  releaseGrowthAdminInterview,
  updateGrowthAdminInterviewQuestion,
  type GrowthAdminInterview,
  type GrowthAdminInterviewOption,
  type GrowthAdminInterviewQuestion,
} from "@/lib/growth/growth-interview-admin-api";
import { captureError } from "@hexclave/shared/dist/utils/errors";
import { runAsynchronously } from "@hexclave/shared/dist/utils/promises";
import { ChatsCircleIcon } from "@phosphor-icons/react";
import { useCallback, useEffect, useState } from "react";

/**
 * The staff review surface for a customer's interview question plan: read what the analysis decided
 * to ask them, fix the wording, cut the weak questions, then release it.
 *
 * Releasing here is what lets the customer start answering — and therefore what starts the chain
 * that ends with a report on their dashboard. Until it happens their timeline says their questions
 * are being prepared, and the interview page is dark. That is why this card is worth its density: a
 * held plan is a customer sitting still.
 *
 * Dense on purpose, like the Games and Reports cards — this is an internal tool and the reader is a
 * pro user.
 */

type CardState =
  | { status: "loading" }
  | { status: "error", message: string }
  | { status: "loaded", interview: GrowthAdminInterview };

/** Serialized so a draft can be compared against what the server holds without a deep-equal helper. */
function optionsKey(options: GrowthAdminInterviewOption[]): string {
  return JSON.stringify(options.map((option) => [option.id, option.label, option.description ?? ""]));
}

function DraftQuestion(props: {
  question: GrowthAdminInterviewQuestion,
  canRemove: boolean,
  busy: boolean,
  onSave: (input: { prompt: string, options: GrowthAdminInterviewOption[], allowSkip: boolean }) => Promise<void>,
  onRemove: () => Promise<void>,
}) {
  const [prompt, setPrompt] = useState(props.question.prompt);
  const [options, setOptions] = useState<GrowthAdminInterviewOption[]>(props.question.options);
  const [allowSkip, setAllowSkip] = useState(props.question.allowSkip);

  // Re-sync when the server hands back a different question for this slot — removing a question
  // re-packs the order indices, so slot 3 can become a different question entirely.
  useEffect(() => {
    setPrompt(props.question.prompt);
    setOptions(props.question.options);
    setAllowSkip(props.question.allowSkip);
  }, [props.question]);

  const dirty = prompt !== props.question.prompt
    || allowSkip !== props.question.allowSkip
    || optionsKey(options) !== optionsKey(props.question.options);

  const setOptionLabel = (index: number, label: string) => {
    setOptions((current) => current.map((option, position) => position === index ? { ...option, label } : option));
  };

  return (
    <div className="rounded-xl border border-foreground/[0.08] p-3">
      <div className="flex items-start justify-between gap-3">
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          {props.question.orderIndex + 1} · {props.question.questionKey} · {props.question.kind} · {props.question.origin}
        </span>
        <DesignButton variant="outline" size="sm" disabled={!props.canRemove || props.busy} onClick={props.onRemove}>
          Remove
        </DesignButton>
      </div>

      <textarea
        className="mt-2 min-h-16 w-full rounded-lg border bg-background p-2 text-sm"
        value={prompt}
        disabled={props.busy}
        onChange={(event) => setPrompt(event.target.value)}
        aria-label={`Question ${props.question.orderIndex + 1} prompt`}
      />

      <div className="mt-2 space-y-1.5">
        {options.map((option, index) => (
          <div key={option.id} className="flex items-center gap-2">
            {/* The option id is the answer's identity — it is what a stored answer points at, and
                what the report phase reads back — so it is shown, never edited. */}
            <span className="w-24 shrink-0 truncate font-mono text-[10px] text-muted-foreground" title={option.id}>{option.id}</span>
            <input
              className="min-w-0 flex-1 rounded-lg border bg-background px-2 py-1 text-sm"
              value={option.label}
              disabled={props.busy}
              onChange={(event) => setOptionLabel(index, event.target.value)}
              aria-label={`Question ${props.question.orderIndex + 1} option ${option.id}`}
            />
            <DesignButton
              variant="outline"
              size="sm"
              // One option left means the question has no choice to make; cutting the last one is a
              // question removal, which is the button above.
              disabled={props.busy || options.length <= 1}
              onClick={() => setOptions((current) => current.filter((_, position) => position !== index))}
            >
              ×
            </DesignButton>
          </div>
        ))}
        <DesignButton
          variant="outline"
          size="sm"
          // The wire caps a question at nine options, matching what the agent may write.
          disabled={props.busy || options.length >= 9}
          onClick={() => setOptions((current) => [...current, { id: `option_${current.length + 1}`, label: "", description: null }])}
        >
          + add option
        </DesignButton>
      </div>

      <label className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
        <input
          type="checkbox"
          checked={allowSkip}
          disabled={props.busy}
          onChange={(event) => setAllowSkip(event.target.checked)}
        />
        skippable
      </label>

      {dirty && (
        <div className="mt-2 flex justify-end">
          <DesignButton
            size="sm"
            disabled={props.busy || prompt.trim().length === 0 || options.some((option) => option.label.trim().length === 0)}
            onClick={async () => await props.onSave({ prompt, options, allowSkip })}
          >
            Save question
          </DesignButton>
        </div>
      )}
    </div>
  );
}

/** A released plan is read-only: the customer may already be answering it. */
function ReleasedQuestions(props: { interview: GrowthAdminInterview }) {
  return (
    <div className="space-y-1.5">
      {props.interview.questions.map((question) => (
        <div key={question.id} className="rounded-xl border border-foreground/[0.08] p-3">
          <p className="text-sm">{question.orderIndex + 1}. {question.prompt}</p>
          <p className="mt-1 font-mono text-[11px] text-muted-foreground">
            {question.options.map((option) => option.label).join(" · ")}
          </p>
          <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            {question.questionKey} · {question.origin}
            {question.answeredAtMillis != null && " · answered"}
          </p>
        </div>
      ))}
    </div>
  );
}

export function GrowthAdminInterviewCard(props: { app: object, projectId: string }) {
  const [state, setState] = useState<CardState>({ status: "loading" });
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  // Pinned once per mount rather than read during render, so the relative timestamps do not shift.
  const [nowMillis] = useState(() => Date.now());

  const load = useCallback(async () => {
    setState({ status: "loading" });
    try {
      setState({ status: "loaded", interview: await getGrowthAdminInterview(props.app, props.projectId) });
    } catch (error) {
      captureError("growth-admin-interview-load", error);
      setState({ status: "error", message: error instanceof Error ? error.message : String(error) });
    }
  }, [props.app, props.projectId]);

  useEffect(() => {
    runAsynchronously(load());
  }, [load]);

  /**
   * Every mutation replaces the whole plan. Errors surface inline rather than throwing: the common
   * ones ("no interview yet" on a young project, "already released") are normal answers about where
   * this customer is in the lifecycle, and need to read as information rather than as a crash.
   */
  const mutate = async (label: string, mutation: () => Promise<GrowthAdminInterview>) => {
    setActionError(null);
    setBusy(true);
    try {
      setState({ status: "loaded", interview: await mutation() });
    } catch (error) {
      captureError(label, error);
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const subtitle = "Read the questions the analysis wrote for this customer, fix them, then release the interview";

  if (state.status === "loading") {
    return (
      <DesignCard title="Interview" subtitle={subtitle} icon={ChatsCircleIcon} gradient="purple">
        <div className="h-24 animate-pulse rounded-xl border bg-foreground/[0.03]" aria-busy="true" aria-label="Loading interview" />
      </DesignCard>
    );
  }
  if (state.status === "error") {
    return (
      <DesignCard title="Interview" subtitle={subtitle} icon={ChatsCircleIcon} gradient="purple">
        <DesignAlert variant="info">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span>{state.message}</span>
            <DesignButton variant="outline" size="sm" onClick={load}>Retry</DesignButton>
          </div>
        </DesignAlert>
      </DesignCard>
    );
  }

  const { interview } = state;
  const held = interview.releasedAtMillis == null;

  return (
    <DesignCard title="Interview" subtitle={subtitle} icon={ChatsCircleIcon} gradient="purple">
      <div className="space-y-4">
        {actionError != null && <DesignAlert variant="error">{actionError}</DesignAlert>}

        <div className="flex flex-wrap items-center gap-2">
          <DesignBadge label={held ? "held" : "released"} color={held ? "orange" : "green"} size="sm" />
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            {interview.status} · run {interview.runStatus} · written {formatGrowthRelativeTime(interview.createdAtMillis, nowMillis)}
            {interview.releasedAtMillis != null && ` · released ${formatGrowthRelativeTime(interview.releasedAtMillis, nowMillis)}`}
          </span>
        </div>

        {held && (
          <div className="flex flex-wrap items-center gap-2">
            <DesignButton
              size="sm"
              disabled={busy || interview.questions.length === 0}
              onClick={async () => await mutate("growth-admin-interview-release", () => releaseGrowthAdminInterview(props.app, props.projectId))}
            >
              Release to customer
            </DesignButton>
            <DesignButton
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={async () => {
                setActionError(null);
                setBusy(true);
                try {
                  await regenerateGrowthAdminInterview(props.app, props.projectId);
                  // Regenerating returns no plan — the phase writes the replacement asynchronously —
                  // so reload rather than swapping in a body we do not have. The reload will 404
                  // until the new questions land, which the info alert above reads correctly.
                  await load();
                } catch (error) {
                  captureError("growth-admin-interview-regenerate", error);
                  setActionError(error instanceof Error ? error.message : String(error));
                } finally {
                  setBusy(false);
                }
              }}
            >
              Regenerate plan
            </DesignButton>
          </div>
        )}

        {held ? (
          <div className="space-y-2">
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              Draft · {interview.questions.length} questions
            </p>
            {interview.questions.map((question) => (
              <DraftQuestion
                key={question.id}
                question={question}
                canRemove={interview.questions.length > 1}
                busy={busy}
                onSave={async (input) => await mutate("growth-admin-interview-edit", () => updateGrowthAdminInterviewQuestion(props.app, props.projectId, question.id, input))}
                onRemove={async () => await mutate("growth-admin-interview-remove", () => deleteGrowthAdminInterviewQuestion(props.app, props.projectId, question.id))}
              />
            ))}
          </div>
        ) : (
          <div className="space-y-2">
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              Live · {interview.questions.length} questions
            </p>
            {/* No edit controls: the customer may be mid-answer, and rewording a question they have
                already answered changes what their answer meant. The backend refuses these edits
                too — this is the UI agreeing with it, not the UI enforcing it. */}
            <ReleasedQuestions interview={interview} />
          </div>
        )}
      </div>
    </DesignCard>
  );
}
