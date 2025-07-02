'use client';
import type {
  CollapsibleContentProps,
  CollapsibleTriggerProps,
} from '@radix-ui/react-collapsible';
import { Presence } from '@radix-ui/react-presence';
import { type ScrollAreaProps } from '@radix-ui/react-scroll-area';
import { cva } from 'class-variance-authority';
import { usePathname } from 'fumadocs-core/framework';
import Link, { type LinkProps } from 'fumadocs-core/link';
import type { PageTree } from 'fumadocs-core/server';
import { useMediaQuery } from 'fumadocs-core/utils/use-media-query';
import { useOnChange } from 'fumadocs-core/utils/use-on-change';
import { useSidebar } from 'fumadocs-ui/contexts/sidebar';
import { useTreeContext, useTreePath } from 'fumadocs-ui/contexts/tree';
import {
  type ComponentProps,
  createContext,
  type FC,
  Fragment,
  type HTMLAttributes,
  type ReactNode,
  useContext,
  useMemo,
  useRef,
  useState,
} from 'react';
import { RemoveScroll } from 'react-remove-scroll';
import { cn } from '../../lib/cn';
import { isActive } from '../../lib/is-active';
import { ChevronDown, ExternalLink } from '../icons';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '../ui/collapsible';
import { ScrollArea, ScrollViewport } from '../ui/scroll-area';

export type SidebarProps = {
  /**
   * Open folders by default if their level is lower or equal to a specific level
   * (Starting from 1)
   *
   * @defaultValue 0
   */
  defaultOpenLevel?: number,

  /**
   * Prefetch links
   *
   * @defaultValue true
   */
  prefetch?: boolean,

  /**
   * Support collapsing the sidebar on desktop mode
   *
   * @defaultValue true
   */
  collapsible?: boolean,
} & ComponentProps<'aside'>

type InternalContext = {
  defaultOpenLevel: number,
  prefetch: boolean,
  level: number,
}

const itemVariants = cva(
  'relative flex flex-row items-center gap-2 text-start py-2.5 px-3 rounded-lg [overflow-wrap:anywhere] [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      active: {
        true: 'bg-fd-primary/10 text-fd-primary font-medium shadow-sm',
        false:
          'text-fd-muted-foreground hover:bg-fd-accent/50 hover:text-fd-accent-foreground/80',
      },
    },
  },
);

const Context = createContext<InternalContext | null>(null);
const FolderContext = createContext<{
  open: boolean,
  setOpen: React.Dispatch<React.SetStateAction<boolean>>,
} | null>(null);

export function Sidebar({
  defaultOpenLevel = 0,
  prefetch = true,
  collapsible = true,
  ...props
}: SidebarProps) {
  const { open, setOpen, collapsed } = useSidebar();
  const context = useMemo<InternalContext>(() => {
    return {
      defaultOpenLevel,
      prefetch,
      level: 1,
    };
  }, [defaultOpenLevel, prefetch]);

  const [hover, setHover] = useState(false);
  const timerRef = useRef(0);
  const closeTimeRef = useRef(0);
  // md
  const isMobile = useMediaQuery('(width < 768px)') ?? false;

  useOnChange(collapsed, () => {
    setHover(false);
    closeTimeRef.current = Date.now() + 150;
  });

  if (isMobile) {
    const state = open ? 'open' : 'closed';

    return (
      <>
        <Presence present={open}>
          <div
            data-state={state}
            className="fixed z-40 inset-0 bg-black/30 backdrop-blur-sm data-[state=open]:animate-fd-fade-in data-[state=closed]:animate-fd-fade-out"
            onClick={() => setOpen(false)}
          />
        </Presence>
        <Presence present={open}>
          {({ present }) => {
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const { ref, ...restProps } = props;
            return (
              <RemoveScroll
                as="aside"
                enabled={present}
                id="nd-sidebar-mobile"
                {...restProps}
                data-state={state}
                className={cn(
                  'fixed text-[15px] flex flex-col py-3 rounded-xl shadow-lg start-0 ms-3 mt-3 mb-3 inset-y-0 w-[85%] max-w-[360px] z-40 bg-fd-background/95 backdrop-blur-md data-[state=open]:animate-fd-enterFromLeft data-[state=closed]:animate-fd-exitToLeft',
                  !present && 'invisible',
                  props.className,
                )}
              >
                <Context.Provider value={context}>
                  {props.children}
                </Context.Provider>
              </RemoveScroll>
            );
          }}
        </Presence>
      </>
    );
  }

  return (
    <aside
      id="nd-sidebar"
      {...props}
      data-collapsed={collapsed}
      className={cn(
        'sticky top-(--fd-sidebar-top) z-20 h-(--fd-sidebar-height) max-md:hidden',
        collapsible && [
          'transition-all duration-300',
          collapsed &&
            '-me-(--fd-sidebar-width) -translate-x-(--fd-sidebar-offset) rtl:translate-x-(--fd-sidebar-offset)',
          collapsed && hover && 'z-50 translate-x-0',
          collapsed && !hover && 'opacity-0',
        ],
        'px-4 py-4',
        props.className,
      )}
      style={
        {
          '--fd-sidebar-offset': 'calc(var(--fd-sidebar-width) - 6px)',
          '--fd-sidebar-top':
            'calc(var(--fd-banner-height) + var(--fd-nav-height) + 1rem)',
          '--fd-sidebar-height':
            'calc(100dvh - var(--fd-banner-height) - var(--fd-nav-height) - 2rem)',
          ...props.style,
        } as object
      }
      onPointerEnter={(e) => {
        if (
          !collapsible ||
          !collapsed ||
          e.pointerType === 'touch' ||
          closeTimeRef.current > Date.now()
        )
          return;
        window.clearTimeout(timerRef.current);
        setHover(true);
      }}
      onPointerLeave={(e) => {
        if (!collapsible || !collapsed || e.pointerType === 'touch') return;
        window.clearTimeout(timerRef.current);

        timerRef.current = window.setTimeout(
          () => {
            setHover(false);
            closeTimeRef.current = Date.now() + 150;
          },
          Math.min(e.clientX, document.body.clientWidth - e.clientX) > 100
            ? 0
            : 500,
        );
      }}
    >
      <div className="flex w-(--fd-sidebar-width) h-full max-w-full flex-col ms-auto rounded-2xl bg-fd-card shadow-lg border border-fd-border/20">
        <Context.Provider value={context}>{props.children}</Context.Provider>
      </div>
    </aside>
  );
}

export function SidebarHeader(props: ComponentProps<'div'>) {
  return (
    <div
      {...props}
      className={cn('flex flex-col gap-3 px-4 py-4 rounded-t-2xl bg-fd-card/50 backdrop-blur-sm', props.className)}
    >
      {props.children}
    </div>
  );
}

export function SidebarFooter(props: ComponentProps<'div'>) {
  return (
    <div
      {...props}
      className={cn('flex flex-col px-4 py-3 mt-auto rounded-b-2xl bg-fd-card/50 backdrop-blur-sm', props.className)}
    >
      {props.children}
    </div>
  );
}

export function SidebarViewport(props: ScrollAreaProps) {
  return (
    <ScrollArea {...props} className={cn('h-full flex-1', props.className)}>
      <ScrollViewport
        className="px-4 py-3"
        style={{
          maskImage: 'linear-gradient(to bottom, transparent, white 12px)',
        }}
      >
        {props.children}
      </ScrollViewport>
    </ScrollArea>
  );
}

export function SidebarSeparator(props: ComponentProps<'p'>) {
  return (
    <div className="flex justify-center w-full mb-4 mt-6">
      <p
        {...props}
        className={cn(
          'inline-flex items-center justify-center gap-2 px-6 py-2.5 font-bold text-xs uppercase tracking-widest text-fd-foreground bg-fd-accent/10 border border-fd-accent/40 rounded-full shadow-md relative overflow-hidden empty:mb-0 [&_svg]:size-4 [&_svg]:shrink-0',
          props.className,
        )}
        style={{
          ...props.style,
        }}
      >
        {props.children}
      </p>
    </div>
  );
}

export function SidebarItem({
  icon,
  ...props
}: LinkProps & {
  icon?: ReactNode,
}) {
  const pathname = usePathname();
  const active =
    props.href !== undefined && isActive(props.href, pathname, false);
  const { prefetch, level } = useInternalContext();

  return (
    <Link
      {...props}
      data-active={active}
      className={cn(itemVariants({ active }), props.className)}
      prefetch={prefetch}
      style={{
        paddingInlineStart: getOffset(level),
        ...props.style,
      }}
    >
      <Border level={level} active={active} />
      {icon ?? (props.external ? <ExternalLink /> : null)}
      {props.children}
    </Link>
  );
}

export function SidebarFolder({
  defaultOpen = false,
  ...props
}: ComponentProps<'div'> & {
  defaultOpen?: boolean,
}) {
  const [open, setOpen] = useState(defaultOpen);

  useOnChange(defaultOpen, (v) => {
    if (v) setOpen(v);
  });

  return (
    <Collapsible open={open} onOpenChange={setOpen} {...props}>
      <FolderContext.Provider
        value={useMemo(() => ({ open, setOpen }), [open])}
      >
        {props.children}
      </FolderContext.Provider>
    </Collapsible>
  );
}

export function SidebarFolderTrigger({
  className,
  ...props
}: CollapsibleTriggerProps) {
  const { level } = useInternalContext();
  const { open } = useFolderContext();

  return (
    <CollapsibleTrigger
      className={cn(
        itemVariants({ active: false }),
        'w-full group !py-2 !px-3',
        open && 'bg-fd-accent/30',
        className
      )}
      {...props}
      style={{
        paddingInlineStart: getOffset(level),
        ...props.style,
      }}
    >
      <Border level={level} />
      {props.children}
      <ChevronDown
        data-icon
        className={cn(
          'ms-auto',
          !open && '-rotate-90'
        )}
      />
    </CollapsibleTrigger>
  );
}

export function SidebarFolderLink(props: LinkProps) {
  const { open, setOpen } = useFolderContext();
  const { prefetch, level } = useInternalContext();

  const pathname = usePathname();
  const active =
    props.href !== undefined && isActive(props.href, pathname, false);

  return (
    <Link
      {...props}
      data-active={active}
      className={cn(
        itemVariants({ active }),
        'w-full group',
        open && !active && 'bg-fd-accent/30',
        props.className
      )}
      onClick={(e) => {
        if (
          e.target instanceof HTMLElement &&
          e.target.hasAttribute('data-icon')
        ) {
          setOpen(!open);
          e.preventDefault();
        } else {
          setOpen(active ? !open : true);
        }
      }}
      prefetch={prefetch}
      style={{
        paddingInlineStart: getOffset(level),
        ...props.style,
      }}
    >
      <Border level={level} active={active} />
      {props.children}
      <ChevronDown
        data-icon
        className={cn(
          'ms-auto',
          !open && '-rotate-90'
        )}
      />
    </Link>
  );
}

export function SidebarFolderContent(props: CollapsibleContentProps) {
  const ctx = useInternalContext();

  return (
    <CollapsibleContent
      {...props}
      className={cn(
        'relative overflow-hidden transition-all duration-200',
        props.className
      )}
    >
      <Context.Provider
        value={useMemo(
          () => ({
            ...ctx,
            level: ctx.level + 1,
          }),
          [ctx],
        )}
      >
        {ctx.level === 1 && (
          <div className="absolute w-0.5 inset-y-0 bg-fd-border/50 start-3 rounded-full" />
        )}
        <div className="py-0.5 my-1">
          {props.children}
        </div>
      </Context.Provider>
    </CollapsibleContent>
  );
}

export function SidebarCollapseTrigger(props: ComponentProps<'button'>) {
  const { collapsed, setCollapsed } = useSidebar();

  return (
    <button
      type="button"
      aria-label="Collapse Sidebar"
      data-collapsed={collapsed}
      {...props}
      className={cn(
        'hover:scale-105 active:scale-95 bg-fd-card rounded-full p-1.5 shadow-sm',
        props.className
      )}
      onClick={() => {
        setCollapsed((prev) => !prev);
      }}
    >
      {props.children}
    </button>
  );
}

function useFolderContext() {
  const ctx = useContext(FolderContext);

  if (!ctx) throw new Error('Missing sidebar folder');
  return ctx;
}

function useInternalContext() {
  const ctx = useContext(Context);
  if (!ctx) throw new Error('<Sidebar /> component required.');

  return ctx;
}

export type SidebarComponents = {
  Item: FC<{ item: PageTree.Item }>,
  Folder: FC<{ item: PageTree.Folder, level: number, children: ReactNode }>,
  Separator: FC<{ item: PageTree.Separator }>,
}

/**
 * Render sidebar items from page tree
 */
export function SidebarPageTree(props: {
  components?: Partial<SidebarComponents>,
}) {
  const { root } = useTreeContext();

  return useMemo(() => {
    const { Separator, Item, Folder } = props.components ?? {};

    function renderSidebarList(
      items: PageTree.Node[],
      level: number,
    ): ReactNode[] {
      return items.map((item, i) => {
        if (item.type === 'separator') {
          if (Separator) return <Separator key={i} item={item} />;
          return (
            <SidebarSeparator key={i} className={cn(i !== 0 && 'mt-5')}>
              {item.icon}
              {item.name}
            </SidebarSeparator>
          );
        }

        if (item.type === 'folder') {
          const children = renderSidebarList(item.children, level + 1);

          if (Folder)
            return (
              <Folder key={i} item={item} level={level}>
                {children}
              </Folder>
            );
          return (
            <PageTreeFolder key={i} item={item}>
              {children}
            </PageTreeFolder>
          );
        }

        if (Item) return <Item key={item.url} item={item} />;
        return (
          <SidebarItem
            key={item.url}
            href={item.url}
            external={item.external}
            icon={item.icon}
          >
            {item.name}
          </SidebarItem>
        );
      });
    }

    return (
      <Fragment key={root.$id}>{renderSidebarList(root.children, 1)}</Fragment>
    );
  }, [props.components, root]);
}

function PageTreeFolder({
  item,
  ...props
}: HTMLAttributes<HTMLElement> & {
  item: PageTree.Folder,
}) {
  const { defaultOpenLevel, level } = useInternalContext();
  const path = useTreePath();

  return (
    <SidebarFolder
      defaultOpen={
        (item.defaultOpen ?? defaultOpenLevel >= level) || path.includes(item)
      }
    >
      {item.index ? (
        <SidebarFolderLink
          href={item.index.url}
          external={item.index.external}
          {...props}
        >
          {item.icon}
          {item.name}
        </SidebarFolderLink>
      ) : (
        <SidebarFolderTrigger {...props}>
          {item.icon}
          {item.name}
        </SidebarFolderTrigger>
      )}
      <SidebarFolderContent>{props.children}</SidebarFolderContent>
    </SidebarFolder>
  );
}

function getOffset(level: number) {
  return `calc(var(--spacing) * ${level > 1 ? (level - 1) * 3 + 3 : 2})`;
}

function Border({ level, active }: { level: number, active?: boolean }) {
  if (level <= 1) return null;

  return (
    <div
      className={cn(
        'absolute w-0.5 rounded-full inset-y-3 z-[2] start-3 md:inset-y-2',
        active ? 'bg-fd-primary' : 'bg-fd-border/40'
      )}
    />
  );
}
