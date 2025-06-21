import { ChevronDown, ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { cn } from '../../lib/cn';

type ParamFieldProps = {
  path: string,
  type: string,
  required?: boolean,
  children: ReactNode,
  className?: string,
  expandable?: boolean,
  expandableContent?: ReactNode,
  expandTitle?: ReactNode,
  properties?: Array<{
    path: string,
    type: string,
    required?: boolean,
    description: string,
  }>,
}

type AccordionProps = {
  title: ReactNode,
  children: ReactNode,
  className?: string,
}

export function ParamField({
  path,
  type,
  required = false,
  children,
  className,
  expandable = false,
  expandableContent,
  expandTitle = <ShowProperties />,
  properties
}: ParamFieldProps) {
    console.log('ParamField props:', { path, expandable, hasExpandableContent: !!expandableContent, hasProperties: !!properties });

    return (
      <div className={cn(
        'border border-fd-border rounded-lg p-4 mb-3',
        'bg-fd-card/30',
        className
      )}>
        <div className="flex items-center gap-2 mb-2">
          <code className="text-sm font-mono text-fd-foreground bg-fd-muted px-2 py-1 rounded">
            {path}
          </code>
          <span className="text-xs text-fd-muted-foreground">
            {type}
          </span>
          {required && (
            <span className="text-xs text-red-500 font-medium">
              required
            </span>
          )}
        </div>
        <div className="text-sm text-fd-muted-foreground prose prose-fd max-w-none">
          {children}
          {expandable && expandableContent && (
            <Accordion title={expandTitle} className="mt-3">
              {expandableContent}
            </Accordion>
          )}
          {properties && properties.length > 0 && (
            <Accordion title={expandTitle} className="mt-3">
              {properties.map((prop) => (
                <ParamField
                  key={prop.path}
                  path={prop.path}
                  type={prop.type}
                  required={prop.required}
                >
                  {prop.description}
                </ParamField>
              ))}
            </Accordion>
          )}
        </div>
      </div>
    );
}

export function Accordion({ title, children, className }: AccordionProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className={cn('mt-3', className)}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 text-sm text-fd-muted-foreground hover:text-fd-foreground transition-colors"
      >
        {isOpen ? (
          <ChevronDown className="h-3 w-3" />
        ) : (
          <ChevronRight className="h-3 w-3" />
        )}
        {title}
      </button>
      {isOpen && (
        <div className="mt-3 pl-5 border-l border-fd-border">
          {children}
        </div>
      )}
    </div>
  );
}

// Helper component for show properties text
export function ShowProperties() {
  return <span className="text-xs">Show properties</span>;
}
