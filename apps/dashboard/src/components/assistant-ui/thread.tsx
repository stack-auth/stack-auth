import { cn } from "@/lib/utils";
import {
  ActionBarPrimitive,
  BranchPickerPrimitive,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
} from "@assistant-ui/react";
import { ArrowClockwiseIcon, ArrowDownIcon, CaretLeftIcon, CaretRightIcon, CheckIcon, CopyIcon, PaperPlaneRightIcon, PencilSimpleIcon, WarningCircle } from "@phosphor-icons/react";
import type { FC } from "react";

import { MarkdownText } from "@/components/assistant-ui/markdown-text";
import { TooltipIconButton } from "@/components/assistant-ui/tooltip-icon-button";
import { Button } from "@/components/ui";

export const Thread: FC<{ useOffWhiteLightMode?: boolean, composerPlaceholder?: string }> = ({ useOffWhiteLightMode = false, composerPlaceholder }) => {
  return (
    <ThreadPrimitive.Root
      className={cn(
        "box-border flex h-0 flex-grow flex-col overflow-hidden",
        useOffWhiteLightMode ? "bg-slate-50/90 dark:bg-background" : "bg-background",
      )}
      style={{
        ["--thread-max-width" as string]: "100%",
      }}
    >
      <ThreadPrimitive.Viewport
        className={cn(
          "flex h-full flex-col items-center overflow-y-auto scroll-smooth px-3",
          useOffWhiteLightMode ? "bg-slate-50/90 dark:bg-inherit" : "bg-inherit",
        )}
      >
        <ThreadWelcome />

        <ThreadPrimitive.Messages
          components={{
            UserMessage: UserMessage,
            EditComposer: EditComposer,
            AssistantMessage: AssistantMessage,
          }}
        />

        <ThreadPrimitive.If empty={false}>
          <div className="min-h-6 flex-grow" />
        </ThreadPrimitive.If>

        <div className={cn(
          "sticky bottom-0 mt-2 flex w-full max-w-[var(--thread-max-width)] flex-col items-center justify-end bg-gradient-to-t to-transparent pt-6 pb-3",
          useOffWhiteLightMode
            ? "from-slate-50/90 via-slate-50/90 dark:from-background dark:via-background"
            : "from-background via-background",
        )}>
          <ThreadScrollToBottom />
          <Composer placeholder={composerPlaceholder} />
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
        className="absolute -top-10 rounded-full disabled:invisible shadow-lg bg-background/80 backdrop-blur-sm ring-1 ring-foreground/[0.06]"
      >
        <ArrowDownIcon size={14} />
      </TooltipIconButton>
    </ThreadPrimitive.ScrollToBottom>
  );
};

const ThreadWelcome: FC = () => {
  return (
    <ThreadPrimitive.Empty>
      <div className="flex w-full max-w-[var(--thread-max-width)] flex-grow flex-col">
        <div className="flex w-full flex-grow flex-col items-center justify-center py-16">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-blue-500/20 to-blue-600/10 flex items-center justify-center mb-5 ring-1 ring-blue-500/20 shadow-lg shadow-blue-500/10">
            <PaperPlaneRightIcon className="w-7 h-7 text-blue-500" weight="duotone" />
          </div>
          <h2 className="text-lg font-semibold tracking-tight text-foreground mb-2">
            Hello! 👋
          </h2>
          <p className="text-sm text-muted-foreground text-center max-w-[260px] leading-relaxed">
            I&apos;m here to help you create beautiful, modern email templates. Describe what you&apos;d like to build.
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

const Composer: FC<{ placeholder?: string }> = ({ placeholder }) => {
  return (
    <ComposerPrimitive.Root className="group/composer relative flex w-full flex-col rounded-2xl border border-border/20 dark:border-foreground/[0.08] bg-white dark:bg-background/90 backdrop-blur-xl shadow-sm dark:shadow-lg ring-1 ring-foreground/[0.04] transition-all duration-150 hover:transition-none focus-within:ring-2 focus-within:ring-blue-500/20 focus-within:border-blue-500/30">
      <ComposerPrimitive.Input
        rows={1}
        autoFocus
        placeholder={placeholder ?? "Describe what you want..."}
        className="placeholder:text-muted-foreground/60 max-h-32 w-full resize-none border-none bg-transparent px-4 py-3 text-sm outline-none focus:ring-0 disabled:cursor-not-allowed leading-relaxed"
      />
      <div className="flex items-center justify-end px-3 pb-2.5">
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
            className="rounded-xl h-7 px-3 bg-blue-600 hover:bg-blue-500 text-white shadow-md shadow-blue-500/20 transition-all duration-150 hover:transition-none active:scale-[0.98]"
          >
            <PaperPlaneRightIcon className="mr-1.5 h-3 w-3" weight="bold" />
            <span className="text-[11px] font-semibold">Generate</span>
          </Button>
        </ComposerPrimitive.Send>
      </ThreadPrimitive.If>
      <ThreadPrimitive.If running>
        <ComposerPrimitive.Cancel asChild>
          <Button
            size="sm"
            variant="outline"
            className="rounded-xl h-7 px-3 border-orange-500/30 bg-orange-500/10 text-orange-600 dark:text-orange-400 hover:bg-orange-500/20"
          >
            <CircleStopIcon className="mr-1.5 h-3 w-3" />
            <span className="text-[11px] font-semibold">Stop</span>
          </Button>
        </ComposerPrimitive.Cancel>
      </ThreadPrimitive.If>
    </div>
  );
};

const UserMessage: FC = () => {
  return (
    <MessagePrimitive.Root className="group flex flex-col items-end w-full max-w-[var(--thread-max-width)] py-3 gap-1.5">
      <div className="flex items-start gap-2 justify-end w-full">
        <UserActionBar />
        <div className="bg-foreground/[0.05] text-foreground max-w-[90%] break-words rounded-2xl px-3.5 py-2.5 text-sm ring-1 ring-foreground/[0.06]">
          <MessagePrimitive.Content />
        </div>
      </div>
      <BranchPicker className="justify-end mr-1" />
    </MessagePrimitive.Root>
  );
};

const UserActionBar: FC = () => {
  return (
    <ActionBarPrimitive.Root
      hideWhenRunning
      autohide="not-last"
      className="flex items-center gap-0.5 self-center opacity-0 group-hover:opacity-100 transition-opacity duration-150"
    >
      <ActionBarPrimitive.Edit asChild>
        <TooltipIconButton tooltip="Edit" className="h-7 w-7 rounded-md hover:bg-foreground/[0.05]">
          <PencilSimpleIcon size={13} />
        </TooltipIconButton>
      </ActionBarPrimitive.Edit>
    </ActionBarPrimitive.Root>
  );
};

const EditComposer: FC = () => {
  return (
    <ComposerPrimitive.Root className="bg-foreground/[0.03] my-3 flex w-full max-w-[var(--thread-max-width)] flex-col gap-2 rounded-xl ring-1 ring-foreground/[0.08]">
      <ComposerPrimitive.Input className="text-foreground flex min-h-[2.5rem] w-full resize-none bg-transparent p-3 pb-0 text-sm outline-none" />

      <div className="px-3 pb-2.5 flex items-center justify-end gap-2">
        <ComposerPrimitive.Cancel asChild>
          <Button variant="ghost" size="sm" className="h-7 px-2.5 text-xs">Cancel</Button>
        </ComposerPrimitive.Cancel>
        <ComposerPrimitive.Send asChild>
          <Button size="sm" className="h-7 px-3 text-xs bg-blue-600 hover:bg-blue-500">Send</Button>
        </ComposerPrimitive.Send>
      </div>
    </ComposerPrimitive.Root>
  );
};

const AssistantMessage: FC = () => {
  return (
    <MessagePrimitive.Root className="flex flex-col relative w-full max-w-[var(--thread-max-width)] py-4 group">
      <div className="flex items-start gap-3">
        <div className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-500/20 to-blue-600/10 flex items-center justify-center shrink-0 ring-1 ring-blue-500/20 shadow-sm">
          <ThreadPrimitive.If running>
            <div className="w-2.5 h-2.5 rounded-full bg-blue-500 animate-pulse" />
          </ThreadPrimitive.If>
          <ThreadPrimitive.If running={false}>
            <div className="w-2.5 h-2.5 rounded-full bg-blue-500" />
          </ThreadPrimitive.If>
        </div>
        <div className="flex-1 min-w-0 space-y-2">
          <div className="text-foreground break-words leading-relaxed text-sm">
            <MessagePrimitive.Content components={{ Text: MarkdownText }} />
          </div>
          <MessageError />
          <AssistantActionBar />
        </div>
      </div>
      <BranchPicker className="mt-1.5 ml-10" />
    </MessagePrimitive.Root>
  );
};

const MessageError: FC = () => {
  return (
    <MessagePrimitive.Error>
      <div className="mt-3 rounded-xl bg-destructive/5 border border-destructive/15 p-4 flex flex-col gap-3 items-center text-center">
        <div className="w-10 h-10 rounded-full bg-destructive/10 flex items-center justify-center ring-1 ring-destructive/20">
          <WarningCircle className="w-5 h-5 text-destructive" weight="fill" />
        </div>
        <div className="space-y-1">
          <p className="text-sm font-semibold text-foreground">Generation Failed</p>
          <p className="text-xs text-muted-foreground max-w-[220px] leading-relaxed">
            Something went wrong while generating your design. Please try again.
          </p>
        </div>
        <ActionBarPrimitive.Root className="w-full mt-1">
          <ActionBarPrimitive.Reload asChild>
            <Button
              variant="outline"
              size="sm"
              className="w-full h-8 gap-2 rounded-lg border-destructive/20 bg-destructive/5 text-destructive hover:bg-destructive/10 hover:text-destructive transition-all duration-150 hover:transition-none"
            >
              <ArrowClockwiseIcon className="w-3.5 h-3.5" />
              <span className="text-xs font-medium">Retry Generation</span>
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
      className="text-muted-foreground flex gap-0.5 -ml-1 opacity-0 group-hover:opacity-100 transition-opacity duration-150 data-[floating]:bg-background/95 data-[floating]:backdrop-blur-sm data-[floating]:absolute data-[floating]:rounded-lg data-[floating]:ring-1 data-[floating]:ring-foreground/[0.06] data-[floating]:p-1 data-[floating]:shadow-md"
    >
      <ActionBarPrimitive.Copy asChild>
        <TooltipIconButton tooltip="Copy" className="h-7 w-7 rounded-md hover:bg-foreground/[0.05]">
          <MessagePrimitive.If copied>
            <CheckIcon size={14} className="text-green-500" />
          </MessagePrimitive.If>
          <MessagePrimitive.If copied={false}>
            <CopyIcon size={14} />
          </MessagePrimitive.If>
        </TooltipIconButton>
      </ActionBarPrimitive.Copy>
      <ActionBarPrimitive.Reload asChild>
        <TooltipIconButton tooltip="Regenerate" className="h-7 w-7 rounded-md hover:bg-foreground/[0.05]">
          <ArrowClockwiseIcon size={14} />
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
      className={cn("text-muted-foreground inline-flex items-center gap-0.5 text-[11px]", className)}
      {...rest}
    >
      <BranchPickerPrimitive.Previous asChild>
        <TooltipIconButton tooltip="Previous" className="h-6 w-6 rounded-md hover:bg-foreground/[0.05]">
          <CaretLeftIcon size={12} />
        </TooltipIconButton>
      </BranchPickerPrimitive.Previous>
      <span className="font-medium tabular-nums px-1">
        <BranchPickerPrimitive.Number /> / <BranchPickerPrimitive.Count />
      </span>
      <BranchPickerPrimitive.Next asChild>
        <TooltipIconButton tooltip="Next" className="h-6 w-6 rounded-md hover:bg-foreground/[0.05]">
          <CaretRightIcon size={12} />
        </TooltipIconButton>
      </BranchPickerPrimitive.Next>
    </BranchPickerPrimitive.Root>
  );
};

const CircleStopIcon = ({ className }: { className?: string }) => {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 16 16"
      fill="currentColor"
      width="16"
      height="16"
      className={className}
    >
      <rect width="10" height="10" x="3" y="3" rx="2" />
    </svg>
  );
};
