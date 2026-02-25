"use client";

import { Check } from "@phosphor-icons/react";
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
    <div className="flex flex-col items-center py-2 gap-1">
      {/* Circles + lines row */}
      <div className="flex items-center">
        {steps.map((step, index) => {
          const isCurrent = step.id === currentStep;
          const isLast = index === steps.length - 1;
          const isPast = index < currentIndex;
          const isClickable = !disableNavigation && isPast && onStepClick;

          return (
            <div key={step.id} className="flex items-center">
              <button
                type="button"
                onClick={() => isClickable && onStepClick(step.id)}
                disabled={!isClickable}
                className={cn(
                  "w-10 h-10 rounded-full flex items-center justify-center transition-colors shrink-0",
                  isPast && "bg-primary text-primary-foreground",
                  isCurrent && "bg-primary text-primary-foreground ring-4 ring-primary/20",
                  !isPast && !isCurrent && "bg-muted-foreground/15 text-muted-foreground",
                  isClickable && "cursor-pointer hover:ring-4 hover:ring-primary/20",
                  !isClickable && "cursor-default"
                )}
              >
                {isPast ? (
                  <Check className="w-4 h-4" weight="bold" />
                ) : (
                  <span className="text-sm font-semibold">{index + 1}</span>
                )}
              </button>

              {!isLast && (
                <div className="w-20 h-1 bg-muted-foreground/15 overflow-hidden">
                  <div
                    className={cn(
                      "h-full bg-primary transition-all duration-300",
                      index < currentIndex ? "w-full" : "w-0"
                    )}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Labels row */}
      <div className="flex items-center">
        {steps.map((step, index) => {
          const isCurrent = step.id === currentStep;
          const isPast = index < currentIndex;
          const isLast = index === steps.length - 1;

          return (
            <div key={step.id} className="flex items-center">
              <span
                className={cn(
                  "w-10 text-center text-[11px] font-medium whitespace-nowrap",
                  isCurrent || isPast ? "text-foreground" : "text-muted-foreground"
                )}
              >
                {step.label}
              </span>
              {!isLast && <div className="w-20" />}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export const DRAFT_STEPS: DraftStep[] = [
  { id: "draft", label: "Draft" },
  { id: "recipients", label: "Recipients" },
  { id: "schedule", label: "Schedule" },
  { id: "sent", label: "Send" },
];
