"use client";

import { DesignCard } from "@/components/design-components/card";
import EmailPreview from "@/components/email-preview";
import { useRouter } from "@/components/router";
import { DesignButton } from "@/components/design-components/button";
import { Typography } from "@/components/ui";
import { cn } from "@/lib/utils";
import { ArrowRightIcon, CheckIcon, PaintBrush } from "@phosphor-icons/react";
import { previewTemplateSource } from "@stackframe/stack-shared/dist/helpers/emails";
import { throwErr } from "@stackframe/stack-shared/dist/utils/errors";
import React, { useMemo } from "react";
import { useAdminApp } from "../use-admin-app";

const PREVIEW_SCALE = 0.50;

function ThemePreviewFrame({ children, className, active, style }: { children: React.ReactNode, className?: string, active?: boolean, style?: React.CSSProperties }) {
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const applyIframeStyles = () => {
      const iframe = el.querySelector("iframe");
      if (iframe) {
        iframe.setAttribute("scrolling", "no");
        iframe.style.overflow = "hidden";
      }
    };
    const observer = new MutationObserver(applyIframeStyles);
    observer.observe(el, { childList: true, subtree: true });
    applyIframeStyles();
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={ref} className={cn("relative shrink-0 rounded-xl border bg-background overflow-clip", className)} style={style}>
      {/* Scale email content down so the full email is visible as a miniature */}
      <div
        className="origin-top-left"
        style={{
          transform: `scale(${PREVIEW_SCALE})`,
          width: `${100 / PREVIEW_SCALE}%`,
          height: `${100 / PREVIEW_SCALE}%`,
        }}
      >
        {children}
      </div>
      {active && (
        <div className="absolute top-3 left-3 z-10 w-6 h-6 bg-green-500 rounded-full flex items-center justify-center shadow-md">
          <CheckIcon className="w-3.5 h-3.5 text-white" weight="bold" />
        </div>
      )}
    </div>
  );
}

export function ThemeSettings() {
  const router = useRouter();
  const stackAdminApp = useAdminApp();
  const config = stackAdminApp.useProject().useConfig();
  const themes = stackAdminApp.useEmailThemes();
  const activeThemeId = config.emails.selectedThemeId;
  const activeTheme = themes.find(t => t.id === activeThemeId) ?? throwErr(`Unknown theme ${activeThemeId}`, { activeThemeId });

  // Pick up to two flanking themes for the carousel, preferring named defaults
  const flankingThemes = useMemo(() => {
    const others = themes.filter(t => t.id !== activeThemeId);
    const byName = new Map(others.map(t => [t.displayName, t]));
    const candidates = [
      byName.get("Default Light"),
      byName.get("Default Dark"),
      byName.get("Default Colorful"),
      ...others,
    ].filter((t): t is typeof themes[number] => t != null);
    const seen = new Set<string>();
    const unique: typeof themes = [];
    for (const t of candidates) {
      if (!seen.has(t.id)) {
        seen.add(t.id);
        unique.push(t);
      }
      if (unique.length >= 2) break;
    }
    return unique;
  }, [themes, activeThemeId]);

  return (
    <DesignCard
      gradient="default"
    >
      {/* Header row -- no divider, showcase overlaps below */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-foreground/[0.06] dark:bg-foreground/[0.04]">
            <PaintBrush className="h-3.5 w-3.5 text-foreground/70 dark:text-muted-foreground" />
          </div>
          <span className="text-xs font-semibold text-foreground uppercase tracking-wider">
            Theme Settings
          </span>
        </div>
        <DesignButton
          variant="outline"
          size="sm"
          className="gap-1.5 hover:bg-accent"
          onClick={(e) => {
            e.stopPropagation();
            router.push("email-themes");
          }}
        >
          Manage Themes
          <ArrowRightIcon className="h-3.5 w-3.5" />
        </DesignButton>
      </div>

      {/* Showcase -- pulls up into the header area with negative margin */}
      <div className="relative h-[280px] -mt-2">
        {flankingThemes[0] && (
          <ThemePreviewFrame className="absolute left-[5%] top-1/2 -translate-y-1/2 w-[35%] h-[220px] opacity-60 shadow-sm border-border/40" style={{ zIndex: 1 }}>
            <EmailPreview themeId={flankingThemes[0].id} templateTsxSource={previewTemplateSource} disableResizing />
          </ThemePreviewFrame>
        )}

        <ThemePreviewFrame className="absolute left-1/2 -translate-x-1/2 top-1/2 -translate-y-1/2 w-[45%] h-[270px] shadow-xl border-border" style={{ zIndex: 2 }} active>
          <EmailPreview themeId={activeTheme.id} templateTsxSource={previewTemplateSource} disableResizing />
        </ThemePreviewFrame>

        {flankingThemes[1] && (
          <ThemePreviewFrame className="absolute right-[5%] top-1/2 -translate-y-1/2 w-[35%] h-[220px] opacity-60 shadow-sm border-border/40" style={{ zIndex: 1 }}>
            <EmailPreview themeId={flankingThemes[1].id} templateTsxSource={previewTemplateSource} disableResizing />
          </ThemePreviewFrame>
        )}
      </div>

      {/* Active theme label */}
      <div className="text-center -mt-1">
        <Typography variant="secondary" className="text-xs">
          Active: <span className="font-medium text-foreground">{activeTheme.displayName}</span>
        </Typography>
      </div>
    </DesignCard>
  );
}
