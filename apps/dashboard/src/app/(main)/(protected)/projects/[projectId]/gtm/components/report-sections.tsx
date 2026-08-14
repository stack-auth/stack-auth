"use client";

import { DesignCard } from "@/components/design-components";
import { cn } from "@/lib/utils";
import type { GrowthReport } from "@/lib/growth/growth-types";
import {
  ChartLineUpIcon,
  FileTextIcon,
  LightbulbIcon,
  TargetIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import type { ComponentPropsWithoutRef, ElementType } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Shared markdown renderer for growth surfaces (report sections, blog draft previews, briefs).
 * The dashboard's other markdown renderer (`components/assistant-ui/markdown-text.tsx`) is bound to the
 * assistant-ui runtime (MarkdownTextPrimitive reads the message from context), so it cannot render a
 * plain string. Like the changelog widget, we use the already-installed react-markdown + remark-gfm
 * directly, with compact component overrides tuned for card bodies.
 */
export function GrowthMarkdown(props: { content: string, className?: string }) {
  return (
    <div className={cn("text-sm leading-relaxed text-foreground", props.className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }: ComponentPropsWithoutRef<"h1">) => (
            <h1 className="mb-2 mt-4 text-base font-semibold tracking-tight first:mt-0">{children}</h1>
          ),
          h2: ({ children }: ComponentPropsWithoutRef<"h2">) => (
            <h2 className="mb-2 mt-4 text-sm font-semibold tracking-tight first:mt-0">{children}</h2>
          ),
          h3: ({ children }: ComponentPropsWithoutRef<"h3">) => (
            <h3 className="mb-1.5 mt-3 text-sm font-semibold first:mt-0">{children}</h3>
          ),
          p: ({ children }: ComponentPropsWithoutRef<"p">) => (
            <p className="mb-3 text-muted-foreground last:mb-0">{children}</p>
          ),
          ul: ({ children }: ComponentPropsWithoutRef<"ul">) => (
            <ul className="mb-3 ml-4 list-disc space-y-1 text-muted-foreground last:mb-0">{children}</ul>
          ),
          ol: ({ children }: ComponentPropsWithoutRef<"ol">) => (
            <ol className="mb-3 ml-4 list-decimal space-y-1 text-muted-foreground last:mb-0">{children}</ol>
          ),
          li: ({ children }: ComponentPropsWithoutRef<"li">) => <li className="leading-relaxed">{children}</li>,
          a: ({ children, href }: ComponentPropsWithoutRef<"a">) => (
            <a href={href} target="_blank" rel="noreferrer" className="font-medium text-foreground underline underline-offset-4">
              {children}
            </a>
          ),
          strong: ({ children }: ComponentPropsWithoutRef<"strong">) => (
            <strong className="font-semibold text-foreground">{children}</strong>
          ),
          blockquote: ({ children }: ComponentPropsWithoutRef<"blockquote">) => (
            <blockquote className="mb-3 border-l-2 border-foreground/[0.15] pl-3 italic text-muted-foreground last:mb-0">
              {children}
            </blockquote>
          ),
          code: ({ children }: ComponentPropsWithoutRef<"code">) => (
            <code className="rounded bg-foreground/[0.06] px-1 py-0.5 font-mono text-[0.85em]">{children}</code>
          ),
          hr: () => <hr className="my-3 border-foreground/[0.08]" />,
        }}
      >
        {props.content}
      </ReactMarkdown>
    </div>
  );
}

type SectionMeta = {
  icon: ElementType,
  gradient: "blue" | "cyan" | "purple" | "green" | "orange" | "default",
};

// `kind` is an open string on the wire (the report composer owns the vocabulary), so this is a styling
// hint map with a neutral fallback rather than an exhaustive union.
const SECTION_KIND_META = new Map<string, SectionMeta>([
  ["insight", { icon: LightbulbIcon, gradient: "cyan" }],
  ["recommendation", { icon: TargetIcon, gradient: "purple" }],
  ["metric", { icon: ChartLineUpIcon, gradient: "blue" }],
  ["risk", { icon: WarningCircleIcon, gradient: "orange" }],
]);

const DEFAULT_SECTION_META: SectionMeta = { icon: FileTextIcon, gradient: "default" };

export function getGrowthReportSectionMeta(kind: string): SectionMeta {
  return SECTION_KIND_META.get(kind) ?? DEFAULT_SECTION_META;
}

/**
 * Renders a report's structured sections as cards; when the composer produced no structured sections
 * (older reports, or a composer fallback), the raw `contentMd` is rendered as a single card instead.
 */
export function GrowthReportSections(props: { report: GrowthReport }) {
  const { report } = props;
  if (report.sections == null) {
    return (
      <DesignCard title="Report" icon={FileTextIcon} gradient="default">
        <GrowthMarkdown content={report.contentMd} />
      </DesignCard>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      {report.sections.map((section, index) => {
        const meta = getGrowthReportSectionMeta(section.kind);
        return (
          // Section ids are nullable on the wire; the index fallback is safe because sections are
          // render-only (never reordered client-side).
          <DesignCard key={section.id ?? `section-${index}`} title={section.title} icon={meta.icon} gradient={meta.gradient}>
            <GrowthMarkdown content={section.bodyMd} />
          </DesignCard>
        );
      })}
    </div>
  );
}
