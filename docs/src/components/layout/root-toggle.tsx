'use client';
import { usePathname } from 'fumadocs-core/framework';
import Link from 'fumadocs-core/link';
import { ChevronDown } from 'lucide-react';
import { type ComponentProps, type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '../../lib/cn';
import { isActive } from '../../lib/is-active';

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

// Platform-specific colors matching homepage
const platformColors: Record<string, string> = {
  'Next.js': 'rgb(59, 130, 246)', // Blue
  'React': 'rgb(16, 185, 129)', // Green
  'JavaScript': 'rgb(245, 158, 11)', // Yellow
  'Python': 'rgb(168, 85, 247)', // Purple
  'Stack Auth Next.js': 'rgb(59, 130, 246)',
  'Stack Auth React': 'rgb(16, 185, 129)',
  'Stack Auth JavaScript': 'rgb(245, 158, 11)',
  'Stack Auth Python': 'rgb(168, 85, 247)',
};

function getPlatformColor(title: ReactNode): string {
  const titleStr = String(title);
  return platformColors[titleStr] || 'rgb(100, 116, 139)'; // fallback color
}

export function RootToggle({
  options,
  ...props
}: {
  options: Option[],
} & ComponentProps<'button'>) {
  const [open, setOpen] = useState(false);
  const [hoveredOption, setHoveredOption] = useState<Option | null>(null);
  const pathname = usePathname();
  const dropdownRef = useRef<HTMLDivElement>(null);

  const selected = useMemo(() => {
    return options.findLast((item) =>
      item.urls
        ? item.urls.has(
            pathname.endsWith('/') ? pathname.slice(0, -1) : pathname,
          )
        : isActive(item.url, pathname, true),
    );
  }, [options, pathname]);

  // Click outside to close dropdown
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setOpen(false);
        setHoveredOption(null);
      }
    };

    if (open) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [open]);

  const selectedColor = selected ? getPlatformColor(selected.title) : 'rgb(100, 116, 139)';

  return (
    <div className="w-full">
      {/* Platform selector label */}
      <div className="mb-3">
        <span className="text-xs font-bold text-fd-foreground uppercase tracking-wider">
          Platform
        </span>
      </div>

      <div className="relative" ref={dropdownRef}>
        <button
          {...props}
          onClick={() => setOpen(!open)}
          className={cn(
            'w-full flex items-center justify-between px-4 py-3 rounded-lg border transition-all duration-300',
            'bg-fd-background border-fd-border hover:shadow-xl hover:-translate-y-0.5',
            props.className,
          )}
          style={{
            ...(open && {
              borderColor: selectedColor,
              boxShadow: `0 4px 20px ${selectedColor}20`,
            }),
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = selectedColor;
            e.currentTarget.style.boxShadow = `0 4px 20px ${selectedColor}20`;
          }}
          onMouseLeave={(e) => {
            if (!open) {
              e.currentTarget.style.borderColor = '';
              e.currentTarget.style.boxShadow = '';
            }
          }}
        >
          <div className="flex items-center gap-3 flex-1 min-w-0">
            {selected ? (
              <>
                {selected.icon}
                <div className="flex-1 text-start min-w-0">
                  <p
                    className="font-semibold text-sm truncate"
                    style={{ color: selectedColor }}
                  >
                    {selected.title}
                  </p>
                  {selected.description && (
                    <p className="text-xs text-fd-muted-foreground truncate">
                      {selected.description}
                    </p>
                  )}
                </div>
              </>
            ) : (
              <span className="text-sm text-fd-muted-foreground">Select platform</span>
            )}
          </div>
          <ChevronDown
            className={cn(
              'size-5 flex-shrink-0 transition-transform duration-300',
              open && 'rotate-180'
            )}
            style={{ color: selectedColor }}
          />
        </button>

        {open && (
          <div className="absolute top-full left-0 right-0 mt-2 bg-fd-background/95 backdrop-blur-lg border-2 border-fd-border rounded-lg shadow-2xl z-50 overflow-hidden">
            {options.map((item) => {
              const isSelected = selected === item;
              const isHovered = hoveredOption === item;
              const isHighlighted = isSelected || isHovered;
              const itemColor = getPlatformColor(item.title);

              return (
                <Link
                  key={item.url}
                  href={item.url}
                  onClick={() => {
                    setOpen(false);
                    setHoveredOption(null);
                  }}
                  onMouseEnter={() => setHoveredOption(item)}
                  onMouseLeave={() => setHoveredOption(null)}
                  {...item.props}
                  className={cn(
                    'w-full px-4 py-3 text-left transition-all duration-200 border-l-4 border-transparent block',
                    isHighlighted ? 'bg-fd-muted/70' : 'hover:bg-fd-muted/30',
                    item.props?.className,
                  )}
                  style={{
                    borderLeftColor: isHighlighted ? itemColor : 'transparent',
                    backgroundColor: isHighlighted ? `${itemColor}15` : undefined,
                  }}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      {item.icon}
                      <div className="flex-1 text-start min-w-0">
                        <p
                          className={cn(
                            'font-medium text-sm truncate transition-all duration-200',
                            isHighlighted && 'font-semibold'
                          )}
                          style={{ color: isHighlighted ? itemColor : undefined }}
                        >
                          {item.title}
                        </p>
                        {item.description && (
                          <p className={cn(
                            'text-xs mt-0.5 truncate transition-all duration-200',
                            isHighlighted ? 'text-fd-muted-foreground' : 'text-fd-muted-foreground/70'
                          )}>
                            {item.description}
                          </p>
                        )}
                      </div>
                    </div>
                    {isSelected && (
                      <div
                        className="w-2 h-2 rounded-full transition-all duration-200"
                        style={{ backgroundColor: itemColor }}
                      />
                    )}
                    {isHovered && !isSelected && (
                      <div
                        className="w-1.5 h-1.5 rounded-full transition-all duration-200"
                        style={{ backgroundColor: itemColor, opacity: 0.6 }}
                      />
                    )}
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
