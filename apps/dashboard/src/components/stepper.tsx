"use client";

import { cn } from "@/lib/utils";
import React, { createContext, useContext, useEffect, useRef, useState } from "react";

type StepperContextType = {
  currentStep: number,
  totalSteps: number,
  goToStep: (step: number) => void,
  nextStep: () => void,
  previousStep: () => void,
  direction: 'forward' | 'backward',
};

const StepperContext = createContext<StepperContextType | null>(null);

export function useStepperContext() {
  const context = useContext(StepperContext);
  if (!context) {
    throw new Error("useStepperContext must be used within a Stepper");
  }
  return context;
}

type StepperProps = {
  children: React.ReactNode,
  currentStep: number,
  onStepChange: (step: number) => void,
  className?: string,
};

export function Stepper({ children, currentStep, onStepChange, className }: StepperProps) {
  const [direction, setDirection] = useState<'forward' | 'backward'>('forward');
  const [dimensions, setDimensions] = useState<{ width: number, height: number }>({ width: 0, height: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const previousStepRef = useRef(currentStep);

  const childrenArray = React.Children.toArray(children);
  const totalSteps = childrenArray.length;

  useEffect(() => {
    if (currentStep > previousStepRef.current) {
      setDirection('forward');
    } else if (currentStep < previousStepRef.current) {
      setDirection('backward');
    }
    previousStepRef.current = currentStep;
  }, [currentStep]);

  useEffect(() => {
    const updateDimensions = () => {
      if (contentRef.current) {
        setDimensions({
          width: contentRef.current.offsetWidth,
          height: contentRef.current.offsetHeight,
        });
      }
    };

    updateDimensions();

    // Use ResizeObserver for smooth size transitions
    const resizeObserver = new ResizeObserver(updateDimensions);
    if (contentRef.current) {
      resizeObserver.observe(contentRef.current);
    }

    return () => {
      resizeObserver.disconnect();
    };
  }, [currentStep]);

  const goToStep = (step: number) => {
    if (step >= 0 && step < totalSteps) {
      onStepChange(step);
    }
  };

  const nextStep = () => {
    goToStep(currentStep + 1);
  };

  const goToPreviousStep = () => {
    goToStep(currentStep - 1);
  };

  const contextValue: StepperContextType = {
    currentStep,
    totalSteps,
    goToStep,
    nextStep,
    previousStep: goToPreviousStep,
    direction,
  };

  return (
    <StepperContext.Provider value={contextValue}>
      <div
        ref={containerRef}
        className={cn("relative overflow-hidden transition-all duration-300 ease-in-out", className)}
        style={{
          width: dimensions.width || 'auto',
          height: dimensions.height || 'auto',
        }}
      >
        <div className="relative">
          {childrenArray.map((child, index) => (
            <div
              key={index}
              ref={index === currentStep ? contentRef : undefined}
              className={cn(
                "transition-all duration-300 ease-in-out",
                index === currentStep ? "" : "absolute inset-0 pointer-events-none"
              )}
              style={{
                opacity: index === currentStep ? 1 : 0,
                transform: index === currentStep
                  ? 'translateX(0)'
                  : index < currentStep
                    ? 'translateX(-20px)'
                    : 'translateX(20px)',
              }}
            >
              {index === currentStep && child}
            </div>
          ))}
        </div>
      </div>
    </StepperContext.Provider>
  );
}

type StepperPageProps = {
  children: React.ReactNode,
  className?: string,
};

export function StepperPage({ children, className }: StepperPageProps) {
  return (
    <div className={cn("w-full", className)}>
      {children}
    </div>
  );
}

