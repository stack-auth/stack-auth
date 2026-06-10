import React from "react";
import { cn } from "~/components/ui";

type Design = "minimal";

const DesignContext = React.createContext<Design>("minimal");

export function DesignProvider(props: { design?: Design, children: React.ReactNode }) {
  return (
    <DesignContext.Provider value={props.design ?? "minimal"}>
      {props.children}
    </DesignContext.Provider>
  );
}

export function useDesign() {
  return React.useContext(DesignContext);
}

export function getButtonRadiusClassName(_design: Design) {
  return "rounded-lg";
}

export function getPageLayoutGapClassName(_design: Design) {
  return "gap-4";
}

export function getSectionLayoutClassName(_design: Design) {
  return "flex flex-col md:flex-row gap-4 items-start md:items-center justify-between";
}

export function getCardClassName(_design: Design, className?: string) {
  return cn(
    "rounded-2xl border border-black/[0.07] dark:border-white/[0.08] bg-white/45 dark:bg-zinc-950/30 p-5 shadow-none",
    className,
  );
}

export function getInsetPanelClassName(_design: Design, className?: string) {
  return cn(
    "rounded-xl border border-black/[0.06] dark:border-white/[0.07] bg-zinc-50/50 dark:bg-zinc-900/25 p-4 shadow-none",
    className,
  );
}

export function getInsetFormPanelClassName(_design: Design, className?: string) {
  return cn(
    "rounded-xl border border-black/[0.06] dark:border-white/[0.07] bg-zinc-50/50 dark:bg-zinc-900/25 p-4",
    className,
  );
}

export function getListContainerClassName(_design: Design, className?: string) {
  return cn(
    "overflow-hidden rounded-xl border border-black/[0.06] dark:border-white/[0.07] bg-zinc-50/35 dark:bg-zinc-900/20",
    className,
  );
}

export function getListRowClassName(_design: Design, className?: string) {
  return cn(
    "flex items-center justify-between gap-3 border-b border-black/[0.05] dark:border-white/[0.06] px-4 py-3 last:border-b-0",
    className,
  );
}

export function getSectionTitleClassName(_design: Design, className?: string) {
  return cn("text-sm font-semibold leading-snug text-foreground", className);
}

export function getSectionDescriptionClassName(_design: Design, className?: string) {
  return cn("mt-1 text-sm leading-relaxed text-muted-foreground", className);
}

export function getFieldClassName(_design: Design, className?: string) {
  return cn(
    "rounded-lg border-black/[0.08] bg-white/50 shadow-none dark:border-white/[0.08] dark:bg-zinc-950/30",
    className,
  );
}

export function getPrimaryButtonClassName(_design: Design, className?: string) {
  return cn("rounded-lg shadow-none transition-colors hover:transition-none", className);
}

export function getOutlineButtonClassName(_design: Design, className?: string) {
  return cn(
    "rounded-lg border-black/[0.08] bg-transparent shadow-none transition-colors hover:bg-zinc-100/70 hover:transition-none dark:border-white/[0.10] dark:hover:bg-zinc-800/60",
    className,
  );
}

export function getDropdownContentClassName(_design: Design, className?: string) {
  return cn(
    "rounded-xl border-black/[0.08] bg-white/95 shadow-md dark:border-white/[0.10] dark:bg-zinc-950/95",
    className,
  );
}

export function getIconContainerClassName(_design: Design, className?: string) {
  return cn(
    "flex size-8 shrink-0 items-center justify-center rounded-lg border border-black/[0.06] bg-zinc-50 text-muted-foreground dark:border-white/[0.07] dark:bg-zinc-900/50",
    className,
  );
}

export function getSkeletonRadiusClassName(_design: Design) {
  return "rounded-xl";
}
