"use client";

import { DesignButton, DesignInput } from "@/components/design-components";

/**
 * The answer controls of the interactive question card. The text input appears only after Other is
 * selected; this keeps ordinary multiple-choice questions compact and makes the custom-answer path
 * explicit instead of presenting a vague optional field under every question.
 */
export function InterviewComposer(props: {
  showOtherAnswer: boolean,
  allowSkip: boolean,
  canConfirm: boolean,
  freeText: string,
  onFreeTextChange: (value: string) => void,
  onConfirm: () => Promise<void>,
  onSkip: () => Promise<void>,
  disabled: boolean,
}) {
  return (
    <div className="flex flex-col gap-2.5">
      {props.showOtherAnswer && (
        <label className="flex flex-col gap-1.5 text-xs font-medium text-foreground">
          Your answer
          <DesignInput
            size="sm"
            placeholder="Type a different answer"
            value={props.freeText}
            onChange={(event) => props.onFreeTextChange(event.target.value)}
            disabled={props.disabled}
            aria-label="Other answer"
            autoFocus
          />
        </label>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <DesignButton size="sm" disabled={props.disabled || !props.canConfirm} onClick={async () => await props.onConfirm()}>
          Confirm answer
        </DesignButton>
        {props.allowSkip && (
          <DesignButton variant="ghost" size="sm" disabled={props.disabled} onClick={async () => await props.onSkip()}>
            Skip this question
          </DesignButton>
        )}
      </div>
    </div>
  );
}
