'use client';

import {
  type BreadcrumbOptions,
  getBreadcrumbItemsFromPath,
} from 'fumadocs-core/breadcrumb';
import { createContext, usePathname } from 'fumadocs-core/framework';
import type { PageTree, TOCItemType } from 'fumadocs-core/server';
import * as Primitive from 'fumadocs-core/toc';
import { useEffectEvent } from 'fumadocs-core/utils/use-effect-event';
import { useI18n } from 'fumadocs-ui/contexts/i18n';
import { useNav, usePageStyles } from 'fumadocs-ui/contexts/layout';
import { useTreeContext, useTreePath } from 'fumadocs-ui/contexts/tree';
import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import {
  type ComponentProps,
  Fragment,
  type HTMLAttributes,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { cn } from '../lib/cn';
import { isActive } from '../lib/is-active';
import { SharedContentLayout } from './layouts/shared-content-layout';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from './ui/collapsible';

const TocPopoverContext = createContext<{
  open: boolean,
  setOpen: (open: boolean) => void,
}>('TocPopoverContext');

export function TocPopoverTrigger({
  items,
  ...props
}: ComponentProps<'button'> & { items: TOCItemType[] }) {
  const { text } = useI18n();
  const { open } = TocPopoverContext.use();
  const active = Primitive.useActiveAnchor();
  const selected = useMemo(
    () => items.findIndex((item) => active === item.url.slice(1)),
    [items, active],
  );
  const path = useTreePath().at(-1);
  const showItem = selected !== -1 && !open;

  return (
    <CollapsibleTrigger
      {...props}
      className={cn(
        'flex flex-row items-center text-sm text-fd-muted-foreground gap-2.5 px-4 py-2.5 text-start focus-visible:outline-none [&_svg]:shrink-0 [&_svg]:size-4 md:px-6',
        props.className,
      )}
    >
      <ProgressCircle
        value={(selected + 1) / items.length}
        max={1}
        className={cn(open && 'text-fd-primary')}
      />
      <span className="grid flex-1 *:my-auto *:row-start-1 *:col-start-1">
        <span
          className={cn(
            'truncate transition-all',
            open && 'text-fd-foreground',
            showItem && 'opacity-0 -translate-y-full pointer-events-none',
          )}
        >
          {path?.name ?? text.toc}
        </span>
        <span
          className={cn(
            'truncate transition-all',
            !showItem && 'opacity-0 translate-y-full pointer-events-none',
          )}
        >
          {items[selected]?.title}
        </span>
      </span>
      <ChevronDown
        className={cn('transition-transform', open && 'rotate-180')}
      />
    </CollapsibleTrigger>
  );
}

type ProgressCircleProps = {
  value: number,
  strokeWidth?: number,
  size?: number,
  min?: number,
  max?: number,
} & Omit<React.ComponentProps<'svg'>, 'strokeWidth'>

function clamp(input: number, min: number, max: number): number {
  if (input < min) return min;
  if (input > max) return max;
  return input;
}

function ProgressCircle({
  value,
  strokeWidth = 2,
  size = 24,
  min = 0,
  max = 100,
  ...restSvgProps
}: ProgressCircleProps) {
  const normalizedValue = clamp(value, min, max);
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = (normalizedValue / max) * circumference;
  const circleProps = {
    cx: size / 2,
    cy: size / 2,
    r: radius,
    fill: 'none',
    strokeWidth,
  };

  return (
    <svg
      role="progressbar"
      viewBox={`0 0 ${size} ${size}`}
      aria-valuenow={normalizedValue}
      aria-valuemin={min}
      aria-valuemax={max}
      {...restSvgProps}
    >
      <circle {...circleProps} className="stroke-current/25" />
      <circle
        {...circleProps}
        stroke="currentColor"
        strokeDasharray={circumference}
        strokeDashoffset={circumference - progress}
        strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        className="transition-all"
      />
    </svg>
  );
}

export function TocPopoverContent(props: ComponentProps<'div'>) {
  return (
    <CollapsibleContent
      data-toc-popover=""
      {...props}
      className={cn('flex flex-col max-h-[50vh]', props.className)}
    >
      {props.children}
    </CollapsibleContent>
  );
}

export function TocPopover(props: HTMLAttributes<HTMLDivElement>) {
  const ref = useRef<HTMLElement>(null);
  const [open, setOpen] = useState(false);
  const { tocNav } = usePageStyles();
  const { isTransparent } = useNav();

  const onClick = useEffectEvent((e: Event) => {
    if (!open) return;

    if (ref.current && !ref.current.contains(e.target as HTMLElement))
      setOpen(false);
  });

  useEffect(() => {
    window.addEventListener('click', onClick);

    return () => {
      window.removeEventListener('click', onClick);
    };
  }, [onClick]);

  return (
    <div
      {...props}
      className={cn('sticky overflow-visible z-10', tocNav, props.className)}
      style={{
        ...props.style,
        top: 'calc(var(--fd-banner-height) + var(--fd-nav-height))',
      }}
    >
      <TocPopoverContext.Provider
        value={useMemo(
          () => ({
            open,
            setOpen,
          }),
          [setOpen, open],
        )}
      >
        <Collapsible open={open} onOpenChange={setOpen} asChild>
          <header
            ref={ref}
            id="nd-tocnav"
            {...props}
            className={cn(
              'border-b backdrop-blur-sm transition-colors',
              (!isTransparent || open) && 'bg-fd-background/80',
              open && 'shadow-lg',
            )}
          >
            {props.children}
          </header>
        </Collapsible>
      </TocPopoverContext.Provider>
    </div>
  );
}

export function PageBody(props: HTMLAttributes<HTMLDivElement>) {
  const { page } = usePageStyles();

  return (
    <div
      id="nd-page"
      {...props}
      className={cn('flex w-full min-w-0 flex-col', page, props.className)}
    >
      {props.children}
    </div>
  );
}

export function PageArticle(props: HTMLAttributes<HTMLElement>) {
  const { article } = usePageStyles();

  return (
    <SharedContentLayout
      {...props}
      className={cn(
        article,
        props.className,
      )}
    >
      {props.children}
    </SharedContentLayout>
  );
}

export function LastUpdate(props: { date: Date }) {
  const { text } = useI18n();
  const [date, setDate] = useState('');

  useEffect(() => {
    // to the timezone of client
    setDate(props.date.toLocaleDateString());
  }, [props.date]);

  return (
    <p className="text-sm text-fd-muted-foreground">
      {text.lastUpdate} {date}
    </p>
  );
}

type Item = Pick<PageTree.Item, 'name' | 'description' | 'url'>;
export type FooterProps = {
  /**
   * Items including information for the next and previous page
   */
  items?: {
    previous?: Item,
    next?: Item,
  },
}

function scanNavigationList(tree: PageTree.Node[]) {
  const list: PageTree.Item[] = [];

  tree.forEach((node) => {
    if (node.type === 'folder') {
      if (node.index) {
        list.push(node.index);
      }

      list.push(...scanNavigationList(node.children));
      return;
    }

    if (node.type === 'page' && !node.external) {
      list.push(node);
    }
  });

  return list;
}

const listCache = new WeakMap<PageTree.Root, PageTree.Item[]>();

export function Footer({ items }: FooterProps) {
  const { root } = useTreeContext();
  const pathname = usePathname();

  const { previous, next } = useMemo(() => {
    if (items) return items;

    const cached = listCache.get(root);
    const list = cached ?? scanNavigationList(root.children);
    listCache.set(root, list);

    const idx = list.findIndex((item) => isActive(item.url, pathname, false));

    if (idx === -1) return {};
    return {
      previous: list[idx - 1],
      next: list[idx + 1],
    };
  }, [items, pathname, root]);

  return (
    <div className="flex items-center justify-center gap-16 pt-20 mt-20 border-t border-fd-border/40">
      {previous ? <FooterItem item={previous} index={0} /> : <div className="w-[260px]" />}
      {next ? <FooterItem item={next} index={1} /> : <div className="w-[260px]" />}
    </div>
  );
}

function FooterItem({ item, index }: { item: Item, index: 0 | 1 }) {
  const { text } = useI18n();
  const Icon = index === 0 ? ChevronLeft : ChevronRight;
  const isNext = index === 1;

  return (
    <Link
      href={item.url}
      className={cn(
        'group flex items-center gap-4 px-6 py-5 rounded-md text-sm transition-all duration-300',
        'w-[260px] border border-fd-border/50 bg-fd-background/60 backdrop-blur-sm',
        'hover:border-fd-border hover:bg-fd-background shadow-sm hover:shadow-md',
        'hover:ring-1 hover:ring-fd-primary/10',
        isNext && 'flex-row-reverse text-right'
      )}
    >
      <Icon className={cn(
        'size-5 text-fd-muted-foreground/80 group-hover:text-fd-primary transition-colors duration-300'
      )} />

      <div className={cn('flex flex-col gap-1.5 min-w-0 flex-1', isNext && 'items-end')}>
        <span className="text-[11px] text-fd-muted-foreground/60 font-semibold uppercase tracking-[0.1em] group-hover:text-fd-muted-foreground transition-colors duration-300">
          {index === 0 ? text.previousPage : text.nextPage}
        </span>
        <span className="font-medium text-fd-foreground/90 group-hover:text-fd-foreground leading-snug transition-colors duration-300">
          {item.name}
        </span>
      </div>
    </Link>
  );
}

export type BreadcrumbProps = BreadcrumbOptions;

export function Breadcrumb(options: BreadcrumbProps) {
  const path = useTreePath();
  const { root } = useTreeContext();
  const items = useMemo(() => {
    return getBreadcrumbItemsFromPath(root, path, {
      includePage: options.includePage ?? false,
      ...options,
    });
  }, [options, path, root]);

  if (items.length === 0) return null;

  return (
    <div className="absolute -top-12 left-0 right-0">
      <div className="container max-w-6xl mx-auto px-4 md:px-6">
        <div className="flex flex-row items-center gap-1.5 text-[13px] opacity-60" style={{ color: 'rgb(107, 114, 128)' }}>
          {items.map((item, i) => {
            const className = cn(
              'truncate',
              i === items.length - 1 && 'text-fd-primary font-medium',
            );

            return (
              <Fragment key={i}>
                {i !== 0 && <span className="text-fd-foreground/30">/</span>}
                {item.url ? (
                  <Link
                    href={item.url}
                    className={cn(className, 'transition-opacity hover:opacity-80')}
                  >
                    {item.name}
                  </Link>
                ) : (
                  <span className={className}>{item.name}</span>
                )}
              </Fragment>
            );
          })}
        </div>
      </div>
    </div>
  );
}
