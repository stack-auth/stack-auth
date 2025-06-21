'use client';
import { usePathname } from 'fumadocs-core/framework';
import Link from 'fumadocs-core/link';
import { ChevronsUpDown } from 'lucide-react';
import { type ComponentProps, type ReactNode, useMemo, useState } from 'react';
import { cn } from '../../lib/cn';
import { isActive } from '../../lib/is-active';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';

export type Option = {
  /**
   * Redirect URL of the folder, usually the index page
   */
  url: string,

  icon?: ReactNode,
  title: ReactNode,
  description?: ReactNode,

  /**
   * Detect from a list of urls
   */
  urls?: Set<string>,

  props?: ComponentProps<'a'>,
}

export function RootToggle({
  options,
  ...props
}: {
  options: Option[],
} & ComponentProps<'button'>) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  const selected = useMemo(() => {
    return options.findLast((item) =>
      item.urls
        ? item.urls.has(
            pathname.endsWith('/') ? pathname.slice(0, -1) : pathname,
          )
        : isActive(item.url, pathname, true),
    );
  }, [options, pathname]);

  const onClick = () => {
    setOpen(false);
  };

  return (
    <div className="w-full">
      {/* Platform selector label */}
      <div className="mb-2">
        <span className="text-xs font-bold text-fd-foreground uppercase tracking-wider">
          Platform
        </span>
      </div>

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          {...props}
          className={cn(
            'w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg border border-fd-border bg-fd-background hover:bg-fd-muted/50 transition-colors',
            props.className,
          )}
        >
          <div className="flex items-center gap-2 flex-1 min-w-0">
            {selected ? (
              <Item {...selected} compact />
            ) : (
              <span className="text-sm text-fd-muted-foreground">Select platform</span>
            )}
          </div>
          <ChevronsUpDown className="size-4 text-fd-muted-foreground flex-shrink-0" />
        </PopoverTrigger>

        <PopoverContent className="w-(--radix-popover-trigger-width) overflow-hidden p-1">
          {options.map((item) => (
            <Link
              key={item.url}
              href={item.url}
              onClick={onClick}
              {...item.props}
              className={cn(
                'flex w-full flex-row items-center gap-2 px-3 py-2.5 rounded-md transition-colors',
              selected === item
                ? 'bg-fd-primary/10 text-fd-primary'
                : 'hover:bg-fd-muted/50',
              item.props?.className,
            )}
            >
              <Item {...item} />
            </Link>
          ))}
        </PopoverContent>
      </Popover>
    </div>
  );
}

function Item({ compact = false, ...props }: Option & { compact?: boolean }) {
  return (
    <>
      <>{props.icon}</>
      <div className="flex-1 text-start min-w-0">
        <p className={cn(
          "font-medium truncate",
          compact ? "text-sm" : "text-[15px] md:text-sm"
        )}>
          {props.title}
        </p>
        {props.description && !compact ? (
          <p className="text-sm text-fd-muted-foreground md:text-xs truncate">
            {props.description}
          </p>
        ) : null}
      </div>
    </>
  );
}
