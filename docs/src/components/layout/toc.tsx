'use client';
import type { TOCItemType } from 'fumadocs-core/server';
import * as Primitive from 'fumadocs-core/toc';
import { useI18n } from 'fumadocs-ui/contexts/i18n';
import { usePageStyles } from 'fumadocs-ui/contexts/layout';
import { X } from 'lucide-react';
import {
  type ComponentProps,
  type HTMLAttributes,
  type ReactNode,
  useEffect,
  useRef,
  useState
} from 'react';
import { cn } from '../../lib/cn';
import { useSidebar } from '../layouts/sidebar-context';
import { TocThumb } from './toc-thumb';

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
  const topPosition = isHomePage && isScrolled ? 'top-0' : 'top-14';
  const height = isHomePage && isScrolled ? 'h-screen' : 'h-[calc(100vh-3.5rem)]';

  return (
    <div
      id="nd-toc"
      {...props}
      className={cn(
        `hidden md:block fixed ${topPosition} right-0 ${height} bg-fd-background border-l border-fd-border flex flex-col transition-all duration-300 ease-out z-50 w-64`,
        isTocOpen ? 'translate-x-0' : 'translate-x-full',
        toc,
        props.className,
      )}
    >
      {/* Header - Matching AI Chat and Auth Panel */}
      <div className="flex items-center justify-between p-3 border-b border-fd-border bg-fd-background">
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 rounded flex items-center justify-center bg-blue-100 dark:bg-blue-900/30">
            <svg className="w-3 h-3 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </div>
          <div>
            <h3 className="font-medium text-fd-foreground text-sm">Table of Contents</h3>
            <p className="text-xs text-fd-muted-foreground">Navigate this page</p>
          </div>
        </div>
        <button
          onClick={toggleToc}
          className="p-1 text-fd-muted-foreground hover:text-fd-foreground hover:bg-fd-muted rounded transition-colors"
          title="Close table of contents"
          aria-label="Close table of contents"
        >
          <X className="w-3 h-3" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="p-4">
          {props.children}
        </div>
      </div>
    </div>
  );
}

export function TocItemsEmpty() {
  const { text } = useI18n();

  return (
    <div className="rounded-lg border bg-fd-card p-3 text-xs text-fd-muted-foreground">
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

  if (items.length === 0) return <TocItemsEmpty />;

  return (
    <>
      <TocThumb
        containerRef={containerRef}
        className="absolute top-(--fd-top) h-(--fd-height) w-px bg-fd-primary transition-all"
      />
      <div
        ref={containerRef}
        className="flex flex-col border-s border-fd-foreground/10"
      >
        {items.map((item) => (
          <TOCItem key={item.url} item={item} />
        ))}
      </div>
    </>
  );
}

function TOCItem({ item }: { item: TOCItemType }) {
  return (
    <Primitive.TOCItem
      href={item.url}
      className={cn(
        'prose py-1.5 text-sm text-fd-muted-foreground transition-colors [overflow-wrap:anywhere] first:pt-0 last:pb-0 data-[active=true]:text-fd-primary',
        item.depth <= 2 && 'ps-3',
        item.depth === 3 && 'ps-6',
        item.depth >= 4 && 'ps-8',
      )}
    >
      {item.title}
    </Primitive.TOCItem>
  );
}
