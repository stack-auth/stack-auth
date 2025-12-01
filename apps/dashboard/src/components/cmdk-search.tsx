"use client";

import { ALL_APPS_FRONTEND, getItemPath } from "@/lib/apps-frontend";
import { cn } from "@/lib/utils";
import { ALL_APPS, type AppId } from "@stackframe/stack-shared/dist/apps/apps-config";
import {
  Blocks,
  Globe,
  KeyRound,
  Search,
  Settings,
} from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type SearchItem = {
  id: string;
  name: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  category: string;
  keywords?: string[];
};

export function CmdKSearch({
  projectId,
  enabledApps,
}: {
  projectId: string;
  enabledApps: AppId[];
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const router = useRouter();
  const pathname = usePathname();
  const inputRef = useRef<HTMLInputElement>(null);

  // Handle keyboard shortcut and custom event
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
      if (e.key === "Escape") {
        setOpen(false);
      }
    };

    const handleToggle = () => {
      setOpen((prev) => !prev);
    };

    document.addEventListener("keydown", down);
    window.addEventListener("spotlight-toggle", handleToggle);
    return () => {
      document.removeEventListener("keydown", down);
      window.removeEventListener("spotlight-toggle", handleToggle);
    };
  }, []);

  // Focus input when opening
  useEffect(() => {
    if (open) {
      setQuery("");
      setSelectedIndex(0);
      // Small delay to ensure the element is mounted
      requestAnimationFrame(() => {
        inputRef.current?.focus();
      });
    }
  }, [open]);

  // Build search items from enabled apps and navigation
  const searchItems = useMemo(() => {
    const items: SearchItem[] = [];

    // Overview
    items.push({
      id: "overview",
      name: "Overview",
      href: `/projects/${projectId}`,
      icon: Globe,
      category: "Navigation",
      keywords: ["home", "dashboard", "main"],
    });

    // App items
    for (const appId of enabledApps) {
      const app = ALL_APPS[appId];
      const appFrontend = ALL_APPS_FRONTEND[appId];
      if (!app || !appFrontend) continue;

      for (const navItem of appFrontend.navigationItems) {
        items.push({
          id: `${appId}-${navItem.displayName}`,
          name: navItem.displayName,
          href: getItemPath(projectId, appFrontend, navItem),
          icon: appFrontend.icon,
          category: app.displayName,
          keywords: [app.displayName.toLowerCase(), navItem.displayName.toLowerCase()],
        });
      }
    }

    // Settings items
    items.push({
      id: "explore-apps",
      name: "Explore Apps",
      href: `/projects/${projectId}/apps`,
      icon: Blocks,
      category: "Settings",
      keywords: ["apps", "marketplace", "store", "install"],
    });

    items.push({
      id: "project-keys",
      name: "Project Keys",
      href: `/projects/${projectId}/project-keys`,
      icon: KeyRound,
      category: "Settings",
      keywords: ["api", "keys", "credentials", "secret"],
    });

    items.push({
      id: "project-settings",
      name: "Project Settings",
      href: `/projects/${projectId}/project-settings`,
      icon: Settings,
      category: "Settings",
      keywords: ["config", "configuration", "options"],
    });

    return items;
  }, [projectId, enabledApps]);

  // Filter items based on query
  const filteredItems = useMemo(() => {
    if (!query.trim()) return [];

    const searchLower = query.toLowerCase().trim();
    return searchItems.filter((item) => {
      if (item.name.toLowerCase().includes(searchLower)) return true;
      if (item.category.toLowerCase().includes(searchLower)) return true;
      if (item.keywords?.some((k) => k.includes(searchLower))) return true;
      return false;
    });
  }, [query, searchItems]);

  // Reset selection when results change
  useEffect(() => {
    setSelectedIndex(0);
  }, [filteredItems.length]);

  const handleSelect = useCallback(
    (href: string) => {
      setOpen(false);
      router.push(href);
    },
    [router]
  );

  // Handle keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) =>
          prev < filteredItems.length - 1 ? prev + 1 : prev
        );
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((prev) => (prev > 0 ? prev - 1 : prev));
      } else if (e.key === "Enter" && filteredItems[selectedIndex]) {
        e.preventDefault();
        handleSelect(filteredItems[selectedIndex].href);
      }
    },
    [filteredItems, selectedIndex, handleSelect]
  );

  if (!open) return null;

  const hasResults = filteredItems.length > 0;
  const showResults = query.trim().length > 0;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
        style={{
          animation: "spotlight-fade-in 100ms ease-out",
        }}
        onClick={() => setOpen(false)}
      />

      {/* Spotlight Container */}
      <div
        className="fixed left-1/2 top-[18%] z-50 w-full max-w-[560px] -translate-x-1/2 px-4"
        style={{
          animation: "spotlight-slide-in 150ms cubic-bezier(0.16, 1, 0.3, 1)",
        }}
      >
        <div className="relative">
          {/* Rainbow gradient border */}
          <div
            className="absolute -inset-[1px] rounded-2xl opacity-60 blur-[3px]"
            style={{
              background: "linear-gradient(90deg, #f97316, #ec4899, #8b5cf6, #3b82f6, #06b6d4, #10b981, #f97316)",
              backgroundSize: "200% 100%",
              animation: "spotlight-rainbow 4s linear infinite",
            }}
          />
          {/* Inner glow layer */}
          <div
            className="absolute -inset-[1px] rounded-2xl opacity-40"
            style={{
              background: "linear-gradient(90deg, #f97316, #ec4899, #8b5cf6, #3b82f6, #06b6d4, #10b981, #f97316)",
              backgroundSize: "200% 100%",
              animation: "spotlight-rainbow 4s linear infinite",
            }}
          />
          <div
            className={cn(
              "relative overflow-hidden rounded-2xl",
              "bg-background/95 backdrop-blur-xl",
              "shadow-2xl"
            )}
          >
          {/* Search Input */}
          <div className="flex items-center px-5 py-4">
            <Search className="mr-4 h-5 w-5 shrink-0 text-muted-foreground/70" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Search..."
              className="flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground/50"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
            />
          </div>

          {/* Results */}
          {showResults && (
            <div
              className={cn(
                "border-t border-foreground/[0.06]",
                "overflow-hidden"
              )}
              style={{
                animation: "spotlight-results-in 100ms ease-out",
              }}
            >
              {hasResults ? (
                <div className="max-h-[320px] overflow-y-auto py-2 px-2">
                  {filteredItems.map((item, index) => {
                    const IconComponent = item.icon;
                    const isSelected = index === selectedIndex;
                    const isCurrentPage = pathname === item.href;

                    return (
                      <button
                        key={item.id}
                        onClick={() => handleSelect(item.href)}
                        onMouseEnter={() => setSelectedIndex(index)}
                        className={cn(
                          "w-full flex items-center gap-3 rounded-xl px-3 py-2.5 text-left",
                          "transition-colors duration-75",
                          isSelected
                            ? "bg-foreground/[0.06]"
                            : "bg-transparent"
                        )}
                      >
                        <div
                          className={cn(
                            "flex h-9 w-9 items-center justify-center rounded-lg",
                            "bg-foreground/[0.05]"
                          )}
                        >
                          <IconComponent className="h-4 w-4 text-muted-foreground" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-foreground truncate">
                            {item.name}
                          </div>
                          <div className="text-xs text-muted-foreground/70 truncate">
                            {item.category}
                          </div>
                        </div>
                        {isCurrentPage && (
                          <span className="text-[10px] font-medium text-muted-foreground/50 uppercase tracking-wide">
                            Current
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="py-8 text-center text-sm text-muted-foreground/70">
                  No results found
                </div>
              )}
            </div>
          )}
          </div>
        </div>
      </div>

      {/* Inline styles for animations */}
      <style jsx global>{`
        @keyframes spotlight-fade-in {
          from {
            opacity: 0;
          }
          to {
            opacity: 1;
          }
        }
        @keyframes spotlight-slide-in {
          from {
            opacity: 0;
            transform: translateX(-50%) translateY(-8px) scale(0.98);
          }
          to {
            opacity: 1;
            transform: translateX(-50%) translateY(0) scale(1);
          }
        }
        @keyframes spotlight-results-in {
          from {
            opacity: 0;
          }
          to {
            opacity: 1;
          }
        }
        @keyframes spotlight-rainbow {
          0% {
            background-position: 0% 50%;
          }
          100% {
            background-position: 200% 50%;
          }
        }
      `}</style>
    </>
  );
}

// Trigger button component that can be placed in the header
export function CmdKTrigger() {
  return (
    <div className="relative hidden sm:block">
      {/* Rainbow gradient border */}
      <div
        className="absolute -inset-[1px] rounded-xl opacity-50 blur-[2px]"
        style={{
          background: "linear-gradient(90deg, #f97316, #ec4899, #8b5cf6, #3b82f6, #06b6d4, #10b981, #f97316)",
          backgroundSize: "200% 100%",
          animation: "spotlight-rainbow 4s linear infinite",
        }}
      />
      {/* Inner glow layer */}
      <div
        className="absolute -inset-[1px] rounded-xl opacity-30"
        style={{
          background: "linear-gradient(90deg, #f97316, #ec4899, #8b5cf6, #3b82f6, #06b6d4, #10b981, #f97316)",
          backgroundSize: "200% 100%",
          animation: "spotlight-rainbow 4s linear infinite",
        }}
      />
      <button
        onClick={() => window.dispatchEvent(new CustomEvent("spotlight-toggle"))}
        className={cn(
          "relative group flex items-center gap-3 h-9 px-3 min-w-[280px] rounded-xl",
          "bg-background/95 backdrop-blur-sm",
          "text-sm text-muted-foreground",
          "transition-all duration-150 hover:transition-none"
        )}
      >
        <Search className="h-4 w-4 text-muted-foreground/60 group-hover:text-muted-foreground transition-colors duration-150 group-hover:transition-none" />
        <span className="flex-1 text-left text-[13px] text-muted-foreground/70 group-hover:text-muted-foreground transition-colors duration-150 group-hover:transition-none">
          Search pages...
        </span>
        <div className="pointer-events-none flex items-center gap-1">
          <kbd className="flex h-5 min-w-[20px] select-none items-center justify-center rounded bg-foreground/[0.05] px-1 font-mono text-[11px] font-medium text-muted-foreground/60">
            ⌘
          </kbd>
          <kbd className="flex h-5 min-w-[20px] select-none items-center justify-center rounded bg-foreground/[0.05] px-1 font-mono text-[11px] font-medium text-muted-foreground/60">
            K
          </kbd>
        </div>
      </button>
    </div>
  );
}
