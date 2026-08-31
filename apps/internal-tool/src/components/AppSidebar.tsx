"use client";

import { BookOpen, ClipboardCheck, HelpCircle, MessageCircleHeart, PanelLeft, Sparkles } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  AnimatedSidebar,
  AnimatedSidebarContent,
  AnimatedSidebarFooter,
  AnimatedSidebarGroup,
  AnimatedSidebarGroupContent,
  AnimatedSidebarHeader,
  AnimatedSidebarMenu,
  AnimatedSidebarMenuButton,
  AnimatedSidebarMenuItem,
  AnimatedSidebarTrigger,
  useAnimatedSidebar,
} from "./motion/animated-sidebar";
import { ThemeToggle } from "./ThemeToggle";

/** The tool's top-level destinations. `Tab` in app-client.tsx is the source of truth for the ids. */
export type SidebarView = "calls" | "knowledge" | "usage" | "feedback";

const REVIEW: ReadonlyArray<{ value: SidebarView, label: string, icon: typeof ClipboardCheck }> = [
  { value: "calls", label: "MCP Review", icon: ClipboardCheck },
  { value: "feedback", label: "Feedback", icon: MessageCircleHeart },
];

const DATA: ReadonlyArray<{ value: SidebarView, label: string, icon: typeof ClipboardCheck }> = [
  { value: "knowledge", label: "Knowledge Base", icon: BookOpen },
  { value: "usage", label: "AI Endpoint Analytics", icon: Sparkles },
];

const DEFAULT_SIDEBAR_WIDTH = 216;
const MIN_SIDEBAR_WIDTH = 180;
const MAX_SIDEBAR_WIDTH = 360;
const SIDEBAR_WIDTH_STORAGE_KEY = "internal-tool-sidebar-width";

/**
 * Drag handle pinned to the sidebar's trailing edge. It writes `--sidebar-width` on the provider
 * wrapper so the rail can be resized without remounting the panel.
 */
function SidebarResizer() {
  const [width, setWidth] = useState(DEFAULT_SIDEBAR_WIDTH);
  const widthRef = useRef(DEFAULT_SIDEBAR_WIDTH);
  const dragRef = useRef<{ startX: number, startWidth: number } | null>(null);
  const frameRef = useRef<number | null>(null);
  const handleRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLElement | null>(null);
  const maximumWidth = useCallback(
    () => Math.max(MIN_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, window.innerWidth * 0.35)),
    [],
  );

  const applyWidth = useCallback(
    (next: number): number => {
      const clamped = Math.round(Math.min(maximumWidth(), Math.max(MIN_SIDEBAR_WIDTH, next)));
      widthRef.current = clamped;
      // The provider owns `--sidebar-width`; reach it from the handle rather than threading a ref,
      // since the provider is not a forwardRef component.
      wrapperRef.current ??= handleRef.current?.closest<HTMLElement>('[data-slot="sidebar-wrapper"]') ?? null;
      wrapperRef.current?.style.setProperty("--sidebar-width", `${clamped}px`);
      return clamped;
    },
    [maximumWidth],
  );

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const saved = Number(window.localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY));
      setWidth(applyWidth(Number.isFinite(saved) && saved > 0 ? saved : DEFAULT_SIDEBAR_WIDTH));
    });
    const handleResize = () => setWidth(applyWidth(widthRef.current));
    window.addEventListener("resize", handleResize);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", handleResize);
      if (frameRef.current != null) window.cancelAnimationFrame(frameRef.current);
      document.body.classList.remove("resizing-sidebar");
    };
  }, [applyWidth]);

  function commitWidth(next: number): void {
    const applied = applyWidth(next);
    setWidth(applied);
    window.localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(applied));
  }

  return (
    <div
      aria-label="Resize sidebar"
      aria-orientation="vertical"
      aria-valuemax={MAX_SIDEBAR_WIDTH}
      aria-valuemin={MIN_SIDEBAR_WIDTH}
      aria-valuenow={width}
      className="resizer-grip absolute inset-y-0 right-0 z-30 hidden group-data-[state=expanded]/sidebar:block"
      onDoubleClick={() => commitWidth(DEFAULT_SIDEBAR_WIDTH)}
      ref={handleRef}
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft") commitWidth(widthRef.current - 16);
        else if (event.key === "ArrowRight") commitWidth(widthRef.current + 16);
        else if (event.key === "Home") commitWidth(MIN_SIDEBAR_WIDTH);
        else if (event.key === "End") commitWidth(maximumWidth());
        else return;
        event.preventDefault();
      }}
      onPointerCancel={() => {
        dragRef.current = null;
        document.body.classList.remove("resizing-sidebar");
        commitWidth(widthRef.current);
      }}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        dragRef.current = { startX: event.clientX, startWidth: widthRef.current };
        document.body.classList.add("resizing-sidebar");
      }}
      onPointerMove={(event) => {
        if (dragRef.current == null) return;
        const pending = dragRef.current.startWidth + event.clientX - dragRef.current.startX;
        if (frameRef.current != null) window.cancelAnimationFrame(frameRef.current);
        frameRef.current = window.requestAnimationFrame(() => {
          applyWidth(pending);
          frameRef.current = null;
        });
      }}
      onPointerUp={(event) => {
        if (dragRef.current == null) return;
        event.currentTarget.releasePointerCapture(event.pointerId);
        dragRef.current = null;
        document.body.classList.remove("resizing-sidebar");
        commitWidth(widthRef.current);
      }}
      role="separator"
      tabIndex={0}
      title="Drag to resize · Double-click to reset"
    />
  );
}

/** Wordmark row; the collapse toggle sits next to it and survives into the icon rail. */
function SidebarBrand() {
  const { open } = useAnimatedSidebar();
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span
        aria-hidden
        className="grid size-6 shrink-0 place-items-center rounded-lg bg-primary text-[11px] font-semibold text-primary-foreground"
      >
        H
      </span>
      {open && <span className="truncate text-[12px] font-medium text-foreground">Internal Tool</span>}
    </div>
  );
}

/** In the icon rail there is no room for a horizontal switch or the signed-in address. */
function SidebarFooterControls({ userLabel }: { userLabel: string }) {
  const { open } = useAnimatedSidebar();
  return (
    <AnimatedSidebarFooter className="sidebar-footer gap-2 border-t-0 p-2">
      <ThemeToggle vertical={!open} />
      {open && <p className="w-full truncate px-1 text-[11px] text-faint" title={userLabel}>{userLabel}</p>}
    </AnimatedSidebarFooter>
  );
}

export function AppSidebar({
  view,
  onSelectView,
  userLabel,
}: {
  view: SidebarView,
  onSelectView: (view: SidebarView) => void,
  userLabel: string,
}) {
  return (
    <AnimatedSidebar
      ariaLabel="Hexclave internal tool"
      className="min-h-0"
      panelClassName="sidebar-panel h-full border-0 bg-sidebar"
    >
      <AnimatedSidebarHeader className="flex-row items-center justify-between gap-1 border-b-0 px-3 py-2">
        <SidebarBrand />
        <AnimatedSidebarTrigger
          className="size-7 shrink-0 rounded-md text-muted-foreground transition-colors hover:transition-none hover:bg-muted hover:text-foreground"
          title="Toggle sidebar (⌘B)"
        >
          <PanelLeft aria-hidden className="size-4" />
        </AnimatedSidebarTrigger>
      </AnimatedSidebarHeader>

      <AnimatedSidebarContent className="sidebar-content px-2 pt-1">
        <AnimatedSidebarGroup className="sidebar-group">
          <AnimatedSidebarGroupContent>
            <AnimatedSidebarMenu>
              {REVIEW.map((destination) => (
                <AnimatedSidebarMenuItem key={destination.value}>
                  <AnimatedSidebarMenuButton
                    className="sidebar-nav-button"
                    icon={<destination.icon className="size-4" />}
                    isActive={view === destination.value}
                    onSelect={() => onSelectView(destination.value)}
                  >
                    {destination.label}
                  </AnimatedSidebarMenuButton>
                </AnimatedSidebarMenuItem>
              ))}
            </AnimatedSidebarMenu>
          </AnimatedSidebarGroupContent>
        </AnimatedSidebarGroup>

        <div aria-hidden className="mx-3 my-1 h-px bg-border" />

        <AnimatedSidebarGroup className="sidebar-group">
          <AnimatedSidebarGroupContent>
            <AnimatedSidebarMenu>
              {DATA.map((destination) => (
                <AnimatedSidebarMenuItem key={destination.value}>
                  <AnimatedSidebarMenuButton
                    className="sidebar-nav-button"
                    icon={<destination.icon className="size-4" />}
                    isActive={view === destination.value}
                    onSelect={() => onSelectView(destination.value)}
                  >
                    {destination.label}
                  </AnimatedSidebarMenuButton>
                </AnimatedSidebarMenuItem>
              ))}
              <AnimatedSidebarMenuItem>
                {/* /questions is its own route, so this navigates rather than switching the view. */}
                <AnimatedSidebarMenuButton
                  className="sidebar-nav-button"
                  href="/questions"
                  icon={<HelpCircle className="size-4" />}
                >
                  Questions
                </AnimatedSidebarMenuButton>
              </AnimatedSidebarMenuItem>
            </AnimatedSidebarMenu>
          </AnimatedSidebarGroupContent>
        </AnimatedSidebarGroup>
      </AnimatedSidebarContent>

      <SidebarFooterControls userLabel={userLabel} />

      <SidebarResizer />
    </AnimatedSidebar>
  );
}
