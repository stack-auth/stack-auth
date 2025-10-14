'use client';
import type { TOCItemType } from 'fumadocs-core/server';
import * as Primitive from 'fumadocs-core/toc';
import { useI18n } from 'fumadocs-ui/contexts/i18n';
import { usePageStyles } from 'fumadocs-ui/contexts/layout';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type HTMLAttributes,
  type ReactNode
} from 'react';
import { cn } from '../../lib/cn';
import { useSidebar } from '../layouts/sidebar-context';

export type TOCProps = {
  /**
   * Custom content in TOC container, before the main TOC
   */
  header?: ReactNode,

  /**
   * Custom content in TOC container, after the main TOC
   */
  footer?: ReactNode,

  children: ReactNode,
}

export function Toc(props: HTMLAttributes<HTMLDivElement>) {
  const { toc } = usePageStyles();
  const sidebarContext = useSidebar();
  const { isTocOpen, toggleToc } = sidebarContext || {
    isTocOpen: false,
    toggleToc: () => {},
  };

  // State for tracking homepage and scroll detection (similar to AI Chat)
  const [isHomePage, setIsHomePage] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);

  // Detect if we're on homepage and scroll state
  useEffect(() => {
    const checkHomePage = () => {
      setIsHomePage(document.body.classList.contains('home-page'));
    };

    const checkScrolled = () => {
      setIsScrolled(document.body.classList.contains('scrolled'));
    };

    // Initial check
    checkHomePage();
    checkScrolled();

    // Set up observers for class changes
    const observer = new MutationObserver(() => {
      checkHomePage();
      checkScrolled();
    });

    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ['class']
    });

    return () => {
      observer.disconnect();
    };
  }, []);

  // Calculate position based on homepage and scroll state (same as AI Chat and Auth Panel)
  const topPosition = isHomePage && isScrolled ? 'top-0' : 'top-0';
  const height = isHomePage && isScrolled ? 'h-screen' : 'h-[calc(100vh)]';

  return (
    <div
      id="nd-toc"
      {...props}
      className={cn(
        `hidden md:block fixed ${topPosition} right-0 ${height} bg-fd-background flex flex-col transition-all duration-300 ease-out z-50 w-64`,
        isTocOpen ? 'translate-x-0' : 'translate-x-full',
        toc,
        props.className,
      )}
    >
      <div className="flex items-center justify-end px-4 py-3">
        <button
          onClick={toggleToc}
          className="text-xs font-medium text-fd-muted-foreground hover:text-fd-foreground transition-colors"
          title="Close table of contents"
          aria-label="Close table of contents"
        >
          Close
        </button>
      </div>

      <div className="flex-1 overflow-y-auto pb-5">
        <div className="px-4">
          {props.children}
        </div>
      </div>
    </div>
  );
}

export function TocItemsEmpty() {
  const { text } = useI18n();

  return (
    <div className="rounded-md bg-fd-muted/20 p-3 text-xs text-fd-muted-foreground">
      {text.tocNoHeadings}
    </div>
  );
}

export function TOCScrollArea(props: ComponentProps<'div'>) {
  const viewRef = useRef<HTMLDivElement>(null);

  return (
    <div
      {...props}
      ref={viewRef}
      className={cn(
        'relative min-h-0 text-sm ms-px overflow-auto [scrollbar-width:none] [mask-image:linear-gradient(to_bottom,transparent,white_16px,white_calc(100%-16px),transparent)] py-3',
        props.className,
      )}
    >
      <Primitive.ScrollProvider containerRef={viewRef}>
        {props.children}
      </Primitive.ScrollProvider>
    </div>
  );
}

export function TOCItems({ items }: { items: TOCItemType[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [hiddenTabUrls, setHiddenTabUrls] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const hiddenUrls = new Set<string>();

    for (const item of items) {
      const targetId = extractHash(item.url);
      if (!targetId) continue;

      const targetElement = document.getElementById(targetId);
      if (!targetElement) continue;

      if (isInsideTabs(targetElement)) {
        hiddenUrls.add(item.url);
      }
    }

    setHiddenTabUrls(hiddenUrls);
  }, [items]);

  const visibleItems = useMemo(
    () => items.filter((item) => !hiddenTabUrls.has(item.url)),
    [items, hiddenTabUrls],
  );

  if (visibleItems.length === 0) return <TocItemsEmpty />;

  return (
    <>
      <div
        ref={containerRef}
        className="flex flex-col gap-1.5"
      >
        {visibleItems.map((item) => (
          <TOCItem key={item.url} item={item} />
        ))}
      </div>
    </>
  );
}

function TOCItem({ item }: { item: TOCItemType }) {
  const handleClick = (event: React.MouseEvent<HTMLAnchorElement>) => {
    if (typeof window === 'undefined') return;

    const targetId = extractHash(item.url);
    if (!targetId) return;

    const initialTarget = document.getElementById(targetId);
    if (!initialTarget) return;

    event.preventDefault();
    ensureTabsVisible(initialTarget).then(() => {
      requestAnimationFrame(() => {
        const visibleTarget = document.getElementById(targetId);
        if (!visibleTarget) return;
        visibleTarget.scrollIntoView({ behavior: 'smooth', block: 'start' });
        try {
          window.history.replaceState(null, '', `#${targetId}`);
        } catch {
          // no-op if history manipulation is not allowed
        }
      });
    }).catch(() => {
      // Handle promise rejection silently
    });
  };

  return (
    <Primitive.TOCItem
      href={item.url}
      onClick={handleClick}
      className={cn(
        'relative py-1.5 text-sm text-fd-muted-foreground transition-colors [overflow-wrap:anywhere]',
        'hover:text-fd-foreground',
        'data-[active=true]:text-fd-foreground data-[active=true]:font-semibold',
        item.depth <= 2 && 'ps-3',
        item.depth === 3 && 'ps-6',
        item.depth >= 4 && 'ps-8',
      )}
    >
      {item.title}
    </Primitive.TOCItem>
  );
}

function extractHash(url: string): string | null {
  const hashIndex = url.lastIndexOf('#');
  if (hashIndex === -1) return null;
  const hash = url.slice(hashIndex + 1);
  return hash.length > 0 ? decodeURIComponent(hash) : null;
}

async function ensureTabsVisible(element: HTMLElement | null): Promise<void> {
  if (!element) return;

  const tabChain: HTMLElement[] = [];
  let current = element.closest<HTMLElement>('[data-tabs-content]');
  while (current) {
    tabChain.push(current);
    current = current.parentElement?.closest<HTMLElement>('[data-tabs-content]') ?? null;
  }

  for (let i = tabChain.length - 1; i >= 0; i--) {
    await activateTabContent(tabChain[i]);
  }
}

async function activateTabContent(tabContent: HTMLElement): Promise<void> {
  if (tabContent.getAttribute('data-state') === 'active') {
    return;
  }

  const tabValue = tabContent.getAttribute('data-tab-value');
  if (!tabValue) return;

  const tabsRoot = tabContent.closest<HTMLElement>('[data-tabs-root]');
  if (!tabsRoot) return;

  const trigger = findTabTrigger(tabsRoot, tabValue);
  if (!trigger) return;

  trigger.click();
  await waitFor(() => tabContent.getAttribute('data-state') === 'active');
}

function waitFor(condition: () => boolean, timeout = 250): Promise<void> {
  return new Promise((resolve) => {
    const start = performance.now();

    const check = () => {
      if (condition() || performance.now() - start > timeout) {
        resolve();
        return;
      }

      requestAnimationFrame(check);
    };

    check();
  });
}

function isInsideTabs(element: HTMLElement): boolean {
  return Boolean(element.closest<HTMLElement>('[data-tabs-content]'));
}

function findTabTrigger(tabsRoot: HTMLElement, tabValue: string): HTMLElement | null {
  const triggers = tabsRoot.querySelectorAll<HTMLElement>('[data-tabs-trigger]');

  for (const trigger of triggers) {
    if (trigger.getAttribute('data-tab-value') === tabValue) {
      return trigger;
    }
  }

  return null;
}
