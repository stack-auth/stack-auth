"use client";

import { cn } from "@/components/ui";
import { useEffect, useState } from "react";

// Time-of-day-aware ambient background. SSR renders the "morning" variant
// (matching the fixture anchor of 07:30); the real local hour is applied only
// after mount so hydration stays deterministic.

type TimeOfDay = "morning" | "day" | "evening" | "night";

function timeOfDayForHour(hour: number): TimeOfDay {
  if (hour >= 5 && hour < 11) return "morning";
  if (hour >= 11 && hour < 17) return "day";
  if (hour >= 17 && hour < 22) return "evening";
  return "night";
}

const gradientClasses: Record<TimeOfDay, string> = {
  morning: "from-amber-300/[0.14] via-sky-300/[0.10] to-transparent dark:from-amber-400/[0.08] dark:via-sky-500/[0.06]",
  day: "from-sky-300/[0.14] via-cyan-200/[0.08] to-transparent dark:from-sky-400/[0.07] dark:via-cyan-500/[0.05]",
  evening: "from-orange-400/[0.14] via-purple-300/[0.10] to-transparent dark:from-orange-500/[0.08] dark:via-purple-500/[0.06]",
  night: "from-indigo-400/[0.12] via-slate-300/[0.08] to-transparent dark:from-indigo-500/[0.09] dark:via-slate-500/[0.05]",
};

export function useTimeOfDay(): TimeOfDay {
  const [timeOfDay, setTimeOfDay] = useState<TimeOfDay>("morning");
  useEffect(() => {
    setTimeOfDay(timeOfDayForHour(new Date().getHours()));
  }, []);
  return timeOfDay;
}

export function greetingForTimeOfDay(timeOfDay: TimeOfDay): string {
  if (timeOfDay === "morning") return "Good morning";
  if (timeOfDay === "day") return "Good afternoon";
  if (timeOfDay === "evening") return "Good evening";
  return "Burning the midnight oil";
}

export function AmbientGradient({ className }: { className?: string }) {
  const timeOfDay = useTimeOfDay();
  return (
    <div
      aria-hidden
      className={cn(
        "pointer-events-none absolute inset-x-0 top-0 h-[420px] bg-gradient-to-b transition-colors duration-1000",
        gradientClasses[timeOfDay],
        className,
      )}
    />
  );
}
