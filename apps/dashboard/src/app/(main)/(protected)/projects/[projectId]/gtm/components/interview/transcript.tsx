"use client";

import { planQuestionForEntry, type InterviewChatView, type InterviewTranscriptEntry } from "@/lib/growth/growth-interview-chat";
import type { GrowthInterviewQuestion } from "@/lib/growth/growth-types";
import { CheckCircleIcon } from "@phosphor-icons/react";
import { useEffect, useRef, type ComponentPropsWithoutRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { InterviewQuestionCardView, type InterviewAnswerDraft } from "./question-card";

// Markdown-lite: the interview assistant writes short conversational text, so only inline/block
// basics get styling — anything fancier falls back to react-markdown's semantic default elements.
const markdownComponents = {
  p: (props: ComponentPropsWithoutRef<"p">) => <p className="text-sm leading-relaxed" {...props} />,
  ul: (props: ComponentPropsWithoutRef<"ul">) => <ul className="list-disc pl-5 text-sm leading-relaxed" {...props} />,
  ol: (props: ComponentPropsWithoutRef<"ol">) => <ol className="list-decimal pl-5 text-sm leading-relaxed" {...props} />,
  li: (props: ComponentPropsWithoutRef<"li">) => <li className="my-0.5" {...props} />,
  strong: (props: ComponentPropsWithoutRef<"strong">) => <strong className="font-semibold" {...props} />,
  a: (props: ComponentPropsWithoutRef<"a">) => <a className="underline underline-offset-2" target="_blank" rel="noopener noreferrer" {...props} />,
  code: (props: ComponentPropsWithoutRef<"code">) => <code className="rounded bg-foreground/[0.06] px-1 py-0.5 text-xs" {...props} />,
};

function AssistantText(props: { text: string }) {
  // Mirrors UserText's bubble, flipped: same radius and padding, tail on the leading corner, and a
  // fainter fill so the two speakers stay distinguishable at a glance without a second accent colour.
  return (
    <div className="mr-auto max-w-xl space-y-2 rounded-2xl rounded-bl-md bg-foreground/[0.03] px-4 py-2.5 text-foreground">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>{props.text}</ReactMarkdown>
    </div>
  );
}

function UserText(props: { text: string }) {
  return (
    <div className="ml-auto max-w-md whitespace-pre-wrap rounded-2xl rounded-br-md bg-foreground/[0.06] px-4 py-2.5 text-sm">
      {props.text}
    </div>
  );
}

function CompletionMarker() {
  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <CheckCircleIcon size={16} weight="fill" className="text-emerald-500" />
      Interview complete
    </div>
  );
}

export function InterviewThinkingIndicator() {
  return (
    <div className="flex items-center gap-1.5 py-1" role="status" aria-label="The interview assistant is thinking">
      {[0, 1, 2].map((index) => (
        <span
          key={index}
          className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground/60"
          style={{ animationDelay: `${index * 150}ms` }}
        />
      ))}
    </div>
  );
}

function TranscriptEntry(props: {
  entry: InterviewTranscriptEntry,
  /** Entries of a turn that is still streaming are not in the committed positional mapping yet. */
  streaming: boolean,
  questions: GrowthInterviewQuestion[],
  planQuestionByEntryId: InterviewChatView["planQuestionByEntryId"],
  activeQuestion: InterviewChatView["activeQuestion"],
  disabled: boolean,
  onSubmitAnswer: (planQuestion: GrowthInterviewQuestion, draft: InterviewAnswerDraft) => Promise<void>,
}) {
  const { entry } = props;
  switch (entry.type) {
    case "text": {
      return entry.role === "user" ? <UserText text={entry.text} /> : <AssistantText text={entry.text} />;
    }
    case "question": {
      const isActive = props.activeQuestion != null && props.activeQuestion.entryId === entry.id;
      const planQuestion = planQuestionForEntry({
        entryId: entry.id,
        card: entry.card,
        streaming: props.streaming,
        activeQuestion: props.activeQuestion,
        planQuestionByEntryId: props.planQuestionByEntryId,
        questions: props.questions,
      });
      return (
        <InterviewQuestionCardView
          card={entry.card}
          planQuestion={planQuestion}
          interactive={isActive}
          disabled={props.disabled}
          onSubmit={isActive && planQuestion != null
            ? async (draft) => await props.onSubmitAnswer(planQuestion, draft)
            : undefined}
        />
      );
    }
    case "complete": {
      return <CompletionMarker />;
    }
  }
}

/**
 * The chat transcript: committed entries, then the in-flight turn's entries, then the thinking
 * indicator while a turn streams. Auto-scrolls its bottom anchor into view when content grows.
 */
export function InterviewTranscript(props: {
  entries: InterviewTranscriptEntry[],
  streamingEntries: InterviewTranscriptEntry[],
  thinking: boolean,
  questions: GrowthInterviewQuestion[],
  planQuestionByEntryId: InterviewChatView["planQuestionByEntryId"],
  activeQuestion: InterviewChatView["activeQuestion"],
  disabled: boolean,
  onSubmitAnswer: (planQuestion: GrowthInterviewQuestion, draft: InterviewAnswerDraft) => Promise<void>,
}) {
  const bottomAnchorRef = useRef<HTMLDivElement | null>(null);
  const entryCount = props.entries.length + props.streamingEntries.length;
  const initialRenderRef = useRef(true);
  useEffect(() => {
    // Don't yank the page down on first paint — only follow the conversation as it grows.
    if (initialRenderRef.current) {
      initialRenderRef.current = false;
      return;
    }
    bottomAnchorRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [entryCount, props.thinking]);

  return (
    <div className="flex flex-col gap-4">
      {[...props.entries.map((entry) => ({ entry, streaming: false })), ...props.streamingEntries.map((entry) => ({ entry, streaming: true }))].map(({ entry, streaming }) => (
        <TranscriptEntry
          key={entry.id}
          entry={entry}
          streaming={streaming}
          questions={props.questions}
          planQuestionByEntryId={props.planQuestionByEntryId}
          activeQuestion={props.activeQuestion}
          disabled={props.disabled}
          onSubmitAnswer={props.onSubmitAnswer}
        />
      ))}
      {props.thinking && <InterviewThinkingIndicator />}
      <div ref={bottomAnchorRef} />
    </div>
  );
}
