"use client";

import { DesignAlert, DesignBadge, DesignButton, DesignCard } from "@/components/design-components";
import { cn } from "@/components/ui";
import {
  archiveGrowthQuiz,
  generateGrowthQuiz,
  getGrowthQuizAdmin,
  publishGrowthQuiz,
  removeGrowthQuizQuestion,
  updateGrowthQuizQuestion,
} from "@/lib/growth/games/growth-games-admin-api";
import type { GrowthQuizAdminBody, GrowthQuizAdminGame, GrowthQuizAdminQuestion } from "@/lib/growth/games/growth-games-types";
import { formatGrowthRelativeTime } from "@/lib/growth/growth-format";
import { captureError } from "@hexclave/shared/dist/utils/errors";
import { runAsynchronously } from "@hexclave/shared/dist/utils/promises";
import { GameControllerIcon } from "@phosphor-icons/react";
import { useCallback, useEffect, useState } from "react";

/**
 * The staff review surface for the Growth quiz: generate a draft for the selected customer project,
 * fix the wording, drop the weak questions, publish, and then see how they actually did.
 *
 * Everything here is deliberately dense — this is an internal tool, and the reviewer's job is to
 * read eight questions quickly and decide whether they are worth a customer's time.
 *
 * Every mutation returns the whole admin body, so this card re-renders from one authoritative
 * snapshot rather than patching local state and drifting out of sync with the server.
 */

type CardState =
  | { status: "loading" }
  | { status: "error", message: string }
  | { status: "loaded", body: GrowthQuizAdminBody };

/**
 * One reviewable question. The prompt and explanation are editable; the options and the correct one
 * are shown read-only so the reviewer can sanity-check the answer key without being able to change
 * it — those come from real rolled-up metrics and have no write path at all.
 */
function DraftQuestion(props: {
  question: GrowthQuizAdminQuestion,
  canRemove: boolean,
  busy: boolean,
  onSave: (input: { text: string, explanation: string }) => Promise<void>,
  onRemove: () => Promise<void>,
}) {
  const [text, setText] = useState(props.question.text);
  const [explanation, setExplanation] = useState(props.question.explanation);

  // Re-sync when the server hands back a different question for this slot — removing a question
  // re-packs the order indices, so slot 3 can become a different question entirely.
  useEffect(() => {
    setText(props.question.text);
    setExplanation(props.question.explanation);
  }, [props.question.text, props.question.explanation]);

  const dirty = text !== props.question.text || explanation !== props.question.explanation;

  return (
    <div className="rounded-xl border border-foreground/[0.08] p-3">
      <div className="flex items-start justify-between gap-3">
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          {props.question.orderIndex + 1} · {props.question.metricId} · {props.question.factKind}
        </span>
        <DesignButton
          variant="outline"
          size="sm"
          disabled={!props.canRemove || props.busy}
          onClick={props.onRemove}
        >
          Remove
        </DesignButton>
      </div>

      <textarea
        className="mt-2 min-h-16 w-full rounded-lg border bg-background p-2 text-sm"
        value={text}
        disabled={props.busy}
        onChange={(event) => setText(event.target.value)}
        aria-label={`Question ${props.question.orderIndex + 1} prompt`}
      />
      <textarea
        className="mt-2 min-h-12 w-full rounded-lg border bg-background p-2 text-xs"
        value={explanation}
        disabled={props.busy}
        onChange={(event) => setExplanation(event.target.value)}
        aria-label={`Question ${props.question.orderIndex + 1} explanation`}
      />

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {props.question.options.map((option) => (
          <span
            key={option.id}
            className={cn(
              "rounded-md border px-2 py-0.5 font-mono text-[11px]",
              option.id === props.question.correctOptionId
                ? "border-emerald-500/50 bg-emerald-500/[0.1] font-semibold"
                : "border-foreground/[0.1] text-muted-foreground",
            )}
          >
            {option.label}
          </span>
        ))}
        <span className="ml-1 text-[11px] text-muted-foreground">actual: {props.question.trueValueLabel}</span>
      </div>

      {dirty && (
        <div className="mt-2 flex justify-end">
          <DesignButton size="sm" disabled={props.busy} onClick={async () => await props.onSave({ text, explanation })}>
            Save wording
          </DesignButton>
        </div>
      )}
    </div>
  );
}

function PublishedQuestions(props: { game: GrowthQuizAdminGame }) {
  return (
    <div className="space-y-1.5">
      {props.game.questions.map((question) => (
        <div key={question.orderIndex} className="rounded-xl border border-foreground/[0.08] p-3">
          <p className="text-sm">{question.orderIndex + 1}. {question.text}</p>
          <p className="mt-1 font-mono text-[11px] text-muted-foreground">
            {question.metricId} · answer {question.trueValueLabel}
          </p>
        </div>
      ))}
    </div>
  );
}

/** How the customer actually did — the reason the review loop is worth running at all. */
function Results(props: { body: GrowthQuizAdminBody, nowMillis: number }) {
  if (props.body.results.length === 0) {
    return <p className="text-sm text-muted-foreground">No one has played this quiz yet.</p>;
  }
  return (
    <div className="space-y-2">
      {props.body.results.map((result) => (
        <div key={result.id} className="rounded-xl border border-foreground/[0.08] p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <DesignBadge label={result.rankTitle} color={result.correctCount / Math.max(result.questionCount, 1) >= 0.6 ? "green" : "orange"} size="sm" />
              <span className="text-sm tabular-nums">{result.correctCount} / {result.questionCount} right</span>
              <span className="text-xs text-muted-foreground tabular-nums">{result.score} pts</span>
            </div>
            <span className="text-xs text-muted-foreground">
              {result.status === "completed" ? "finished " : "started "}
              {formatGrowthRelativeTime(result.completedAtMillis ?? result.createdAtMillis, props.nowMillis)}
            </span>
          </div>
          {/* Per question, in the published order. A wrong answer names a metric this customer
              misunderstands — which is exactly the kind of thing the note and finding cards above
              this one exist to record. */}
          <div className="mt-2 flex flex-wrap gap-1">
            {result.answers.map((answer) => (
              <span
                key={answer.orderIndex}
                title={`${answer.metricId}: ${answer.answered ? (answer.isCorrect === true ? "correct" : "wrong") : "unanswered"}`}
                className={cn(
                  "rounded px-1.5 py-0.5 font-mono text-[10px]",
                  !answer.answered
                    ? "bg-foreground/[0.06] text-muted-foreground"
                    : answer.isCorrect === true
                      ? "bg-emerald-500/[0.15] text-emerald-700 dark:text-emerald-300"
                      : "bg-destructive/[0.15] text-destructive",
                )}
              >
                {answer.metricId}
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function GrowthAdminGamesCard(props: { app: object, projectId: string }) {
  const [state, setState] = useState<CardState>({ status: "loading" });
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  // Pinned once per mount rather than read during render, so the relative timestamps below do not
  // shift between renders.
  const [nowMillis] = useState(() => Date.now());

  const load = useCallback(async () => {
    setState({ status: "loading" });
    try {
      setState({ status: "loaded", body: await getGrowthQuizAdmin(props.app, props.projectId) });
    } catch (error) {
      captureError("growth-admin-games-load", error);
      setState({ status: "error", message: error instanceof Error ? error.message : String(error) });
    }
  }, [props.app, props.projectId]);

  useEffect(() => {
    runAsynchronously(load());
  }, [load]);

  /**
   * Every mutation replaces the whole body. Errors are surfaced inline rather than thrown: the
   * common one is the "not enough metric history" 409, which is a normal answer for a young project
   * and needs to read as information, not as a crash.
   */
  const mutate = async (label: string, mutation: () => Promise<GrowthQuizAdminBody>) => {
    setActionError(null);
    setBusy(true);
    try {
      setState({ status: "loaded", body: await mutation() });
    } catch (error) {
      captureError(label, error);
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const subtitle = "Generate a quiz from this project's own metrics, review the wording, then publish it to their insights page";

  if (state.status === "loading") {
    return (
      <DesignCard title="Games" subtitle={subtitle} icon={GameControllerIcon} gradient="cyan">
        <div className="h-24 animate-pulse rounded-xl border bg-foreground/[0.03]" aria-busy="true" aria-label="Loading quiz" />
      </DesignCard>
    );
  }
  if (state.status === "error") {
    return (
      <DesignCard title="Games" subtitle={subtitle} icon={GameControllerIcon} gradient="cyan">
        <DesignAlert variant="error">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span>Could not load the quiz: {state.message}</span>
            <DesignButton variant="outline" size="sm" onClick={load}>Retry</DesignButton>
          </div>
        </DesignAlert>
      </DesignCard>
    );
  }

  const { draft, published } = state.body;

  return (
    <DesignCard title="Games" subtitle={subtitle} icon={GameControllerIcon} gradient="cyan">
      <div className="space-y-4">
        {actionError != null && <DesignAlert variant="error">{actionError}</DesignAlert>}

        <div className="flex flex-wrap items-center gap-2">
          <DesignButton
            size="sm"
            disabled={busy}
            onClick={async () => await mutate("growth-admin-games-generate", () => generateGrowthQuiz(props.app, props.projectId))}
          >
            {draft == null ? "Generate a quiz" : "Regenerate draft"}
          </DesignButton>
          {draft != null && (
            <>
              <DesignButton
                size="sm"
                variant="outline"
                disabled={busy || draft.questions.length === 0}
                onClick={async () => await mutate("growth-admin-games-publish", () => publishGrowthQuiz(props.app, props.projectId, draft.id))}
              >
                Publish to customer
              </DesignButton>
              {/* Provenance: whether these words came from the agent or from the deterministic
                  fallback changes how hard a reviewer should look at them. */}
              <DesignBadge label={draft.textSource === "agent" ? "agent-written" : "template wording"} color={draft.textSource === "agent" ? "purple" : "orange"} size="sm" />
              {draft.metricsAsOf != null && <span className="text-xs text-muted-foreground">data to {draft.metricsAsOf}</span>}
            </>
          )}
        </div>

        {draft != null && draft.questions.length > 0 && (
          <div className="space-y-2">
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Draft · {draft.questions.length} questions</p>
            {draft.questions.map((question) => (
              <DraftQuestion
                key={`${draft.id}:${question.orderIndex}`}
                question={question}
                canRemove={draft.questions.length > 1}
                busy={busy}
                onSave={async (input) => await mutate("growth-admin-games-edit", () => updateGrowthQuizQuestion(props.app, props.projectId, draft.id, question.orderIndex, input))}
                onRemove={async () => await mutate("growth-admin-games-remove", () => removeGrowthQuizQuestion(props.app, props.projectId, draft.id, question.orderIndex))}
              />
            ))}
          </div>
        )}

        {published != null && (
          <div className="space-y-2 border-t border-foreground/[0.09] pt-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                Live · published {published.publishedAtMillis == null ? "" : formatGrowthRelativeTime(published.publishedAtMillis, nowMillis)}
              </p>
              <DesignButton
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={async () => await mutate("growth-admin-games-archive", () => archiveGrowthQuiz(props.app, props.projectId, published.id))}
              >
                Take it down
              </DesignButton>
            </div>
            <PublishedQuestions game={published} />
            <p className="pt-2 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Results</p>
            <Results body={state.body} nowMillis={nowMillis} />
          </div>
        )}

        {draft == null && published == null && (
          <p className="text-sm text-muted-foreground">
            No quiz for this project yet. Generating one builds eight questions from its rolled-up metrics — it needs about two weeks of history.
          </p>
        )}
      </div>
    </DesignCard>
  );
}
