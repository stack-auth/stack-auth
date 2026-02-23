"use client";

import { cn } from "@/lib/utils";

export type DraftStep = {
  id: string,
  label: string,
};

type DraftProgressBarProps = {
  steps: DraftStep[],
  currentStep: string,
  onStepClick?: (stepId: string) => void,
  disableNavigation?: boolean,
};

export function DraftProgressBar({ steps, currentStep, onStepClick, disableNavigation }: DraftProgressBarProps) {
  const currentIndex = steps.findIndex((s) => s.id === currentStep);

  return (
    <div className="flex items-center justify-center gap-0 py-4">
      {steps.map((step, index) => {
        const isCurrent = step.id === currentStep;
        const isLast = index === steps.length - 1;
        const isPast = index < currentIndex;
        const isFuture = index > currentIndex;

        // Can only click previous steps when navigation is enabled
        const isClickable = !disableNavigation && isPast && onStepClick;

        const handleClick = () => {
          if (isClickable) {
            onStepClick(step.id);
          }
        };

        return (
          <div key={step.id} className="flex items-center">
            {/* Step circle and label */}
            <button
              type="button"
              onClick={handleClick}
              disabled={!isClickable}
              className={cn(
                "flex flex-col items-center group",
                isClickable && "cursor-pointer",
                !isClickable && "cursor-default"
              )}
            >
              <div
                className={cn(
                  "w-8 h-8 rounded-full flex items-center justify-center border-2 transition-colors",
                  isCurrent
                    ? "bg-primary border-primary text-primary-foreground"
                    : "bg-background border-muted-foreground/30 text-muted-foreground",
                  isClickable && "group-hover:border-primary/50 group-hover:bg-primary/10"
                )}
              >
                <span className="text-xs font-medium">{index + 1}</span>
              </div>
              <span
                className={cn(
                  "mt-2 text-xs font-medium transition-colors",
                  isCurrent ? "text-foreground" : "text-muted-foreground",
                  isClickable && "group-hover:text-foreground"
                )}
              >
                {step.label}
              </span>
            </button>

            {/* Connector line */}
            {!isLast && (
              <div className="w-16 h-0.5 mx-2 -mt-6 bg-muted-foreground/30" />
            )}
          </div>
        );
      })}
    </div>
  );
}

export const DRAFT_STEPS: DraftStep[] = [
  { id: "draft", label: "Draft" },
  { id: "recipients", label: "Choose Recipients" },
  { id: "schedule", label: "Schedule Sending" },
  { id: "sent", label: "Send" },
];
