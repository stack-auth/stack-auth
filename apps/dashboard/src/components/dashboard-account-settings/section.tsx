import React from "react";

export function Section(props: { title: string, description?: string, children: React.ReactNode }) {
  return (
    <div className="border border-black/[0.08] dark:border-white/[0.08] bg-white/80 dark:bg-background/80 backdrop-blur-xl rounded-2xl p-6 shadow-sm ring-1 ring-black/[0.04] dark:ring-0 flex flex-col md:flex-row gap-4 items-start md:items-center justify-between transition-colors">
      <div className="flex-1 flex flex-col justify-center min-w-0">
        <h3 className="font-semibold text-base text-foreground leading-snug">
          {props.title}
        </h3>
        {props.description && (
          <p className="text-muted-foreground text-sm mt-1 leading-relaxed">
            {props.description}
          </p>
        )}
      </div>
      <div className="w-full md:w-auto flex flex-col md:items-end justify-end shrink-0">
        {props.children}
      </div>
    </div>
  );
}
