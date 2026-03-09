'use client';
import type { TOCItemType } from 'fumadocs-core/server';
import * as Primitive from 'fumadocs-core/toc';
import { useI18n } from 'fumadocs-ui/contexts/i18n';
import { usePageStyles } from 'fumadocs-ui/contexts/layout';
import { ClipboardCopy, ExternalLink, FileText, Plug, Wrench } from 'lucide-react';
import { usePathname } from 'next/navigation';
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
  header?: ReactNode,
  footer?: ReactNode,
  children: ReactNode,
}

export function Toc(props: HTMLAttributes<HTMLDivElement>) {
  const { toc } = usePageStyles();
  const sidebarContext = useSidebar();
  const { isTocOpen } = sidebarContext || {
    isTocOpen: false,
  };

  const [isHomePage, setIsHomePage] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);

  useEffect(() => {
    const checkHomePage = () => {
      setIsHomePage(document.body.classList.contains('home-page'));
    };

    const checkScrolled = () => {
      setIsScrolled(document.body.classList.contains('scrolled'));
    };

    checkHomePage();
    checkScrolled();

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

  const topPosition = 'top-14';
  const height = 'h-[calc(100vh-3.5rem)]';

  return (
    <div
      id="nd-toc"
      {...props}
      className={cn(
        `hidden md:block fixed ${topPosition} right-0 ${height} bg-fd-background flex flex-col transition-all duration-300 ease-out z-40 w-64`,
        isTocOpen ? 'translate-x-0' : 'translate-x-full',
        toc,
        props.className,
      )}
    >
      <div className="flex-1 overflow-y-auto pt-4 pb-5">
        <div className="px-4">
          {props.children}
        </div>
      </div>

      <TocActions />
    </div>
  );
}

function TocActions() {
  const pathname = usePathname();
  const [copied, setCopied] = useState(false);

  const handleCopyMarkdown = () => {
    const article = document.querySelector('article');
    if (!article) return;

    const text = article.innerText;
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {
      // silently fail
    });
  };

  const docsUrl = `https://docs.stack-auth.com${pathname}`;

  return (
    <div className="border-t border-fd-border px-4 py-3 space-y-2 flex-shrink-0">
      <div className="flex flex-col gap-0.5">
        <button
          onClick={handleCopyMarkdown}
          className="flex items-center gap-1.5 px-2 py-1 text-[11px] rounded-md text-fd-muted-foreground hover:text-fd-foreground hover:bg-fd-muted/50 transition-colors"
        >
          <ClipboardCopy className="w-3 h-3 flex-shrink-0" />
          <span>{copied ? 'Copied!' : 'Copy page'}</span>
        </button>
        <a
          href={docsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 px-2 py-1 text-[11px] rounded-md text-fd-muted-foreground hover:text-fd-foreground hover:bg-fd-muted/50 transition-colors"
        >
          <ExternalLink className="w-3 h-3 flex-shrink-0" />
          <span>Open</span>
        </a>
        <a
          href="/docs/others/mcp-setup"
          className="flex items-center gap-1.5 px-2 py-1 text-[11px] rounded-md text-fd-muted-foreground hover:text-fd-foreground hover:bg-fd-muted/50 transition-colors"
        >
          <Plug className="w-3 h-3 flex-shrink-0" />
          <span>Install MCP</span>
        </a>
        <a
          href="/llms.txt"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 px-2 py-1 text-[11px] rounded-md text-fd-muted-foreground hover:text-fd-foreground hover:bg-fd-muted/50 transition-colors"
        >
          <FileText className="w-3 h-3 flex-shrink-0" />
          <span>llms.txt</span>
        </a>
        <a
          href="/docs/sdk"
          className="flex items-center gap-1.5 px-2 py-1 text-[11px] rounded-md text-fd-muted-foreground hover:text-fd-foreground hover:bg-fd-muted/50 transition-colors"
        >
          <Wrench className="w-3 h-3 flex-shrink-0" />
          <span>Install skill</span>
        </a>
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
    <div ref={containerRef} className="relative">
      {/* Timeline line */}
      <div className="absolute left-[7px] top-0 bottom-0 w-px bg-fd-border" />

      <div className="flex flex-col">
        {visibleItems.map((item) => (
          <TimelineTOCItem key={item.url} item={item} />
        ))}
      </div>
    </div>
  );
}

function TimelineTOCItem({ item }: { item: TOCItemType }) {
  const active = Primitive.useActiveAnchors();
  const isActive = active.includes(item.url.slice(1));

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
          // no-op
        }
      });
    }).catch(() => {
      // Handle promise rejection silently
    });
  };

  const indent = item.depth <= 2 ? 0 : item.depth === 3 ? 12 : 20;

  return (
    <a
      href={item.url}
      onClick={handleClick}
      className={cn(
        'group relative flex items-start gap-3 py-1.5 text-sm transition-colors [overflow-wrap:anywhere]',
        isActive
          ? 'text-fd-primary font-medium'
          : 'text-fd-muted-foreground hover:text-fd-foreground',
      )}
      style={{ paddingLeft: indent }}
    >
      {/* Timeline dot */}
      <div className="relative flex-shrink-0 mt-[6px]">
        <div
          className={cn(
            'w-[15px] h-[15px] rounded-full border-2 transition-all duration-200',
            isActive
              ? 'border-fd-primary bg-fd-primary scale-110'
              : 'border-fd-border bg-fd-background group-hover:border-fd-muted-foreground',
          )}
        >
          {isActive && (
            <div className="absolute inset-[3px] rounded-full bg-fd-background" />
          )}
        </div>
      </div>

      {/* Text */}
      <span className="flex-1">{item.title}</span>
    </a>
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
