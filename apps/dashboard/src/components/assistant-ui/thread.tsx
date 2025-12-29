import { cn } from "@/lib/utils";
import {
  ActionBarPrimitive,
  BranchPickerPrimitive,
  ComposerPrimitive,
  ErrorPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
} from "@assistant-ui/react";
import { ArrowClockwiseIcon, ArrowDownIcon, CaretLeftIcon, CaretRightIcon, CheckIcon, CopyIcon, PaperPlaneRightIcon, PencilSimpleIcon } from "@phosphor-icons/react";
import type { FC } from "react";

import { MarkdownText } from "@/components/assistant-ui/markdown-text";
import { TooltipIconButton } from "@/components/assistant-ui/tooltip-icon-button";
import { Button } from "@/components/ui";

export const Thread: FC = () => {
  return (
    <ThreadPrimitive.Root
      className="bg-background box-border flex h-0 flex-grow flex-col overflow-hidden"
      style={{
        ["--thread-max-width" as string]: "42rem",
      }}
    >
      <ThreadPrimitive.Viewport className="flex h-full flex-col items-center overflow-y-scroll scroll-smooth bg-inherit px-4">
        <ThreadWelcome />

        <ThreadPrimitive.Messages
          components={{
            UserMessage: UserMessage,
            EditComposer: EditComposer,
            AssistantMessage: AssistantMessage,
          }}
        />

        <ThreadPrimitive.If empty={false}>
          <div className="min-h-8 flex-grow" />
        </ThreadPrimitive.If>

        <div className="sticky bottom-0 mt-3 flex w-full max-w-[var(--thread-max-width)] flex-col items-center justify-end rounded-t-lg bg-inherit pb-4">
          <ThreadScrollToBottom />
          <Composer />
        </div>
      </ThreadPrimitive.Viewport>
    </ThreadPrimitive.Root>
  );
};

const ThreadScrollToBottom: FC = () => {
  return (
    <ThreadPrimitive.ScrollToBottom asChild>
      <TooltipIconButton
        tooltip="Scroll to bottom"
        variant="outline"
        className="absolute -top-8 rounded-full disabled:invisible"
      >
        <ArrowDownIcon />
      </TooltipIconButton>
    </ThreadPrimitive.ScrollToBottom>
  );
};

const ThreadWelcome: FC = () => {
  return (
    <ThreadPrimitive.Empty>
      <div className="flex w-full max-w-[var(--thread-max-width)] flex-grow flex-col">
        <div className="flex w-full flex-grow flex-col items-center justify-center py-20">
          <div className="w-12 h-12 rounded-2xl bg-blue-500/10 flex items-center justify-center mb-6 ring-1 ring-blue-500/20">
            <PaperPlaneRightIcon className="w-6 h-6 text-blue-500" weight="duotone" />
          </div>
          <h2 className="text-xl font-semibold tracking-tight text-foreground mb-2">
            AI Email Designer
          </h2>
          <p className="text-sm text-muted-foreground text-center max-w-[280px] leading-relaxed">
            Describe the design you have in mind, or ask me to improve your current template.
          </p>
        </div>
      </div>
    </ThreadPrimitive.Empty>
  );
};

const ThreadWelcomeSuggestions: FC = () => {
  return (
    <div className="mt-3 flex w-full items-stretch justify-center gap-4">
      <ThreadPrimitive.Suggestion
        className="hover:bg-muted/80 flex max-w-sm grow basis-0 flex-col items-center justify-center rounded-lg border p-3 transition-colors ease-in"
        prompt="Make a modern email theme with a blue color scheme"
        method="replace"
        autoSend
      >
        <span className="line-clamp-2 text-ellipsis text-sm font-semibold">
          Make a blue theme
        </span>
      </ThreadPrimitive.Suggestion>
      <ThreadPrimitive.Suggestion
        className="hover:bg-muted/80 flex max-w-sm grow basis-0 flex-col items-center justify-center rounded-lg border p-3 transition-colors ease-in"
        prompt="Make a modern email theme in dark mode"
        method="replace"
        autoSend
      >
        <span className="line-clamp-2 text-ellipsis text-sm font-semibold">
          Make a dark theme
        </span>
      </ThreadPrimitive.Suggestion>
    </div>
  );
};

const Composer: FC = () => {
  return (
    <ComposerPrimitive.Root className="focus-within:ring-2 focus-within:ring-blue-500/20 focus-within:border-blue-500/30 flex w-full flex-col gap-2 rounded-2xl border bg-background/80 backdrop-blur-xl px-4 py-3 shadow-2xl transition-all duration-200">
      <ComposerPrimitive.Input
        rows={1}
        autoFocus
        placeholder="Describe the email design you want..."
        className="placeholder:text-muted-foreground max-h-40 w-full resize-none border-none bg-transparent py-2 text-sm outline-none focus:ring-0 disabled:cursor-not-allowed leading-relaxed"
      />
      <div className="flex items-center justify-between mt-1">
        <div className="flex items-center gap-2">
          <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">
            AI Email Designer
          </p>
        </div>
        <ComposerAction />
      </div>
    </ComposerPrimitive.Root>
  );
};

const ComposerAction: FC = () => {
  return (
    <div className="flex items-center gap-2">
      <ThreadPrimitive.If running={false}>
        <ComposerPrimitive.Send asChild>
          <Button
            size="sm"
            className="rounded-xl h-8 px-4 bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-500/20 transition-all active:scale-95"
          >
            <PaperPlaneRightIcon className="mr-2 h-3.5 w-3.5" weight="bold" />
            <span className="text-xs font-semibold">Generate</span>
          </Button>
        </ComposerPrimitive.Send>
      </ThreadPrimitive.If>
      <ThreadPrimitive.If running>
        <ComposerPrimitive.Cancel asChild>
          <Button
            size="sm"
            variant="outline"
            className="rounded-xl h-8 px-4 border-blue-500/20 hover:bg-blue-500/10 hover:text-blue-500"
          >
            <CircleStopIcon className="mr-2 h-3 w-3" />
            <span className="text-xs font-semibold">Stop</span>
          </Button>
        </ComposerPrimitive.Cancel>
      </ThreadPrimitive.If>
    </div>
  );
};

const UserMessage: FC = () => {
  return (
    <MessagePrimitive.Root className="flex flex-col items-end w-full max-w-[var(--thread-max-width)] py-4 gap-2">
      <div className="flex items-start gap-3 justify-end w-full">
        <UserActionBar />
        <div className="bg-foreground/[0.04] text-foreground max-w-[85%] break-words rounded-2xl px-4 py-2.5 text-sm ring-1 ring-foreground/[0.06]">
          <MessagePrimitive.Content />
        </div>
      </div>
      <BranchPicker className="justify-end mr-2" />
    </MessagePrimitive.Root>
  );
};

const UserActionBar: FC = () => {
  return (
    <ActionBarPrimitive.Root
      hideWhenRunning
      autohide="not-last"
      className="flex items-center gap-1 self-center opacity-0 group-hover:opacity-100 transition-opacity"
    >
      <ActionBarPrimitive.Edit asChild>
        <TooltipIconButton tooltip="Edit" className="hover:bg-foreground/[0.05]">
          <PencilSimpleIcon size={14} />
        </TooltipIconButton>
      </ActionBarPrimitive.Edit>
    </ActionBarPrimitive.Root>
  );
};

const EditComposer: FC = () => {
  return (
    <ComposerPrimitive.Root className="bg-muted my-4 flex w-full max-w-[var(--thread-max-width)] flex-col gap-2 rounded-xl">
      <ComposerPrimitive.Input className="text-foreground flex h-8 w-full resize-none bg-transparent p-4 pb-0 outline-none" />

      <div className="mx-3 mb-3 flex items-center justify-center gap-2 self-end">
        <ComposerPrimitive.Cancel asChild>
          <Button variant="ghost">Cancel</Button>
        </ComposerPrimitive.Cancel>
        <ComposerPrimitive.Send asChild>
          <Button>Send</Button>
        </ComposerPrimitive.Send>
      </div>
    </ComposerPrimitive.Root>
  );
};

const AssistantMessage: FC = () => {
  return (
    <MessagePrimitive.Root className="flex flex-col relative w-full max-w-[var(--thread-max-width)] py-6 group">
      <div className="flex items-start gap-4">
        <div className="w-8 h-8 rounded-full bg-blue-500/10 flex items-center justify-center shrink-0 border border-blue-500/20">
          <div className="w-4 h-4 rounded-full bg-blue-500 animate-pulse" />
        </div>
        <div className="flex-1 space-y-2">
          <div className="text-foreground break-words leading-relaxed text-sm">
            <MessagePrimitive.Content components={{ Text: MarkdownText }} />
          </div>
          <MessageError />
          <AssistantActionBar />
        </div>
      </div>
      <BranchPicker className="mt-2 ml-12" />
    </MessagePrimitive.Root>
  );
};

const MessageError: FC = () => {
  return (
    <MessagePrimitive.Error>
      <div className="mt-4 rounded-2xl bg-destructive/5 border border-destructive/20 p-5 flex flex-col gap-3 items-center text-center">
        <div className="p-2 rounded-full bg-destructive/10">
          <ErrorPrimitive.Root className="text-destructive">
            <ErrorPrimitive.Message className="hidden" />
          </ErrorPrimitive.Root>
          <ArrowClockwiseIcon className="w-5 h-5 text-destructive animate-spin-slow" />
        </div>
        <div className="space-y-1">
          <p className="text-sm font-semibold text-foreground">Generation Failed</p>
          <p className="text-xs text-muted-foreground max-w-[200px]">
            Something went wrong while generating your design. Please try again.
          </p>
        </div>
        <ActionBarPrimitive.Root className="w-full">
          <ActionBarPrimitive.Reload asChild>
            <Button variant="outline" size="sm" className="w-full gap-2 border-destructive/20 hover:bg-destructive/10 hover:text-destructive">
              <ArrowClockwiseIcon className="w-4 h-4" />
              Retry Generation
            </Button>
          </ActionBarPrimitive.Reload>
        </ActionBarPrimitive.Root>
      </div>
    </MessagePrimitive.Error>
  );
};

const AssistantActionBar: FC = () => {
  return (
    <ActionBarPrimitive.Root
      hideWhenRunning
      autohide="not-last"
      autohideFloat="single-branch"
      className="text-muted-foreground flex gap-1 col-start-3 row-start-2 -ml-1 data-[floating]:bg-background data-[floating]:absolute data-[floating]:rounded-md data-[floating]:border data-[floating]:p-1 data-[floating]:shadow-sm"
    >
      <ActionBarPrimitive.Copy asChild>
        <TooltipIconButton tooltip="Copy">
          <MessagePrimitive.If copied>
            <CheckIcon />
          </MessagePrimitive.If>
          <MessagePrimitive.If copied={false}>
            <CopyIcon />
          </MessagePrimitive.If>
        </TooltipIconButton>
      </ActionBarPrimitive.Copy>
      <ActionBarPrimitive.Reload asChild>
        <TooltipIconButton tooltip="Refresh">
          <ArrowClockwiseIcon />
        </TooltipIconButton>
      </ActionBarPrimitive.Reload>
    </ActionBarPrimitive.Root>
  );
};

const BranchPicker: FC<BranchPickerPrimitive.Root.Props> = ({
  className,
  ...rest
}) => {
  return (
    <BranchPickerPrimitive.Root
      hideWhenSingleBranch
      className={cn("text-muted-foreground inline-flex items-center text-xs", className)}
      {...rest}
    >
      <BranchPickerPrimitive.Previous asChild>
        <TooltipIconButton tooltip="Previous">
          <CaretLeftIcon />
        </TooltipIconButton>
      </BranchPickerPrimitive.Previous>
      <span className="font-medium">
        <BranchPickerPrimitive.Number /> / <BranchPickerPrimitive.Count />
      </span>
      <BranchPickerPrimitive.Next asChild>
        <TooltipIconButton tooltip="Next">
          <CaretRightIcon />
        </TooltipIconButton>
      </BranchPickerPrimitive.Next>
    </BranchPickerPrimitive.Root>
  );
};

const CircleStopIcon = () => {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 16 16"
      fill="currentColor"
      width="16"
      height="16"
    >
      <rect width="10" height="10" x="3" y="3" rx="2" />
    </svg>
  );
};
