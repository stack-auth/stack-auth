'use client';

import { ChevronDown, ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { cn } from '../../lib/cn';

type MethodLayoutProps = {
  children: ReactNode,
  className?: string,
}

type MethodContentProps = {
  children: ReactNode,
  className?: string,
}

type MethodAsideProps = {
  children: ReactNode,
  className?: string,
  title?: string,
}

// Enhanced collapsible wrapper for individual method sections with borders
export function MethodSection({
  children,
  className,
  defaultOpen = true,
  title
}: {
    children: ReactNode,
    className?: string,
    defaultOpen?: boolean,
    title?: string,
  }) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className={cn(
        'border border-fd-border rounded-lg bg-gradient-to-br from-fd-card/20 to-fd-card/30 mb-2',
        className
      )}>
      {title && (
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="w-full flex items-center justify-between px-3 py-0.5 text-left hover:bg-fd-accent/5 transition-colors rounded-t-lg"
        >
          <span className="font-medium text-fd-foreground text-sm leading-none">{title}</span>
          {isOpen ? (
            <ChevronDown className="w-3 h-3 text-fd-muted-foreground transition-transform" />
          ) : (
            <ChevronRight className="w-3 h-3 text-fd-muted-foreground transition-transform" />
          )}
        </button>
      )}

      {title ? (
        <div
          className={cn(
              'transition-all duration-300 ease-in-out overflow-hidden',
              isOpen ? 'max-h-[2000px] opacity-100' : 'max-h-0 opacity-0'
            )}
        >
          <div className="border-t border-fd-border/50">
            <div className="p-3">
              {children}
            </div>
          </div>
        </div>
      ) : (
        <div className="p-3">
          {children}
        </div>
      )}
    </div>
  );
}

export function MethodLayout({ children, className }: MethodLayoutProps) {
  return (
    <div className={cn(
      'grid grid-cols-1 lg:grid-cols-2 gap-8 my-2',
      className
    )}>
      {children}
    </div>
  );
}

export function MethodContent({ children, className }: MethodContentProps) {
  return (
    <div className={cn(
      'prose prose-fd max-w-none',
      className
    )}>
      {children}
    </div>
  );
}

export function MethodAside({ children, className, title }: MethodAsideProps) {
  return (
    <div className={cn(
      'lg:sticky lg:top-8 lg:self-start',
      'bg-fd-card/50 rounded-lg border border-fd-border p-4',
      'backdrop-blur-sm',
      '[&_h3]:!mt-0 [&_h3]:!mb-4',
      className
    )}>
      {title && (
        <div className="text-sm font-semibold text-fd-foreground mb-4">
          {title}
        </div>
      )}
      {children}
    </div>
  );
}

export function AsideSection({
  children,
  title,
  className
}: {
  children: ReactNode,
  title: string,
  className?: string,
}) {
  return (
    <div className={cn('mb-4 last:mb-0', className)}>
      <div className="text-sm font-semibold text-fd-foreground mb-3">
        {title}
      </div>
      {children}
    </div>
  );
}

export function MethodTitle({
  method,
  signature,
  appType
}: {
    method: string,
    signature?: string,
    appType: 'StackClientApp' | 'StackServerApp',
  }) {
  // Generate anchor ID based on method name and app type
  const methodName = method.replace(/[^a-z0-9]/gi, '').toLowerCase();
  const signaturePart = signature ? signature.replace(/[^a-z0-9]/gi, '').toLowerCase() : '';
  const anchorId = `${appType.toLowerCase()}${methodName}${signaturePart}`;

  return (
    <div className="method-title mb-1">
      <div className="flex items-baseline justify-between">
        <div className="flex items-baseline gap-1.5">
          <h2 id={anchorId} className="text-base font-bold text-fd-foreground m-0 font-mono scroll-mt-20 leading-tight">
            <a href={`#${anchorId}`} className="hover:text-fd-accent-foreground transition-colors !no-underline decoration-none underline-none" style={{ textDecoration: 'none !important', textDecorationLine: 'none', borderBottom: 'none', outline: 'none' }}>
              {method}
            </a>
          </h2>
          {signature && (
            <span className="text-xs text-fd-muted-foreground font-mono font-normal">
              ({signature})
            </span>
          )}
        </div>
        <span className={`px-1.5 py-0.5 rounded text-xs font-semibold ${
            appType === 'StackClientApp'
              ? 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/50'
              : 'bg-violet-50 dark:bg-violet-950/50 text-violet-700 dark:text-violet-300 border border-violet-200 dark:border-violet-800/50'
          }`}>
          {appType}
        </span>
      </div>
    </div>
  );
}

// Collapsible method section that integrates with MethodTitle
export function CollapsibleMethodSection({
  children,
  className,
  defaultOpen = true,
  method,
  signature,
  appType
}: {
    children: ReactNode,
    className?: string,
    defaultOpen?: boolean,
    method: string,
    signature?: string,
    appType: 'StackClientApp' | 'StackServerApp',
  }) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  // Generate anchor ID (same as MethodTitle)
  const methodName = method.replace(/[^a-z0-9]/gi, '').toLowerCase();
  const signaturePart = signature ? signature.replace(/[^a-z0-9]/gi, '').toLowerCase() : '';
  const anchorId = `${appType.toLowerCase()}${methodName}${signaturePart}`;

  // Full display name with optional signature (e.g., "StackClientApp.getUser()" or "StackServerApp.listUsers()")
  const fullName = signature
    ? `${method}(${signature})`
    : method;

  // Type-based styling for different app types
  const getAppTypeStyle = (appTypeName: string) => {
    switch (appTypeName) {
      case 'StackClientApp': {
        return 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300';
      }
      case 'StackServerApp': {
        return 'bg-violet-50 dark:bg-violet-950/50 text-violet-700 dark:text-violet-300';
      }
      default: {
        return 'bg-gray-50 dark:bg-gray-950/50 text-gray-700 dark:text-gray-300';
      }
    }
  };

  return (
    <div className={cn(
        'border border-fd-border rounded-lg bg-gradient-to-br from-fd-card/20 to-fd-card/30 mb-2',
        className
      )}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-fd-accent/5 transition-colors rounded-t-lg"
      >
        <div className="flex items-center gap-1.5">
          <div id={anchorId} className="text-m font-medium text-fd-foreground font-mono scroll-mt-20 leading-none">
            {fullName}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${getAppTypeStyle(appType)}`}>
            {appType}
          </span>
          {isOpen ? (
            <ChevronDown className="w-3 h-3 text-fd-muted-foreground transition-transform" />
          ) : (
            <ChevronRight className="w-3 h-3 text-fd-muted-foreground transition-transform" />
          )}
        </div>
      </button>

      <div
        className={cn(
            'transition-all duration-300 ease-in-out overflow-hidden',
            isOpen ? 'max-h-[2000px] opacity-100' : 'max-h-0 opacity-0'
          )}
      >
        <div className="border-t border-fd-border/50">
          <div className="p-3">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

export function CollapsibleTypesSection({
  children,
  className,
  defaultOpen = true,
  type,
  property,
  signature
}: {
    children: ReactNode,
    className?: string,
    defaultOpen?: boolean,
    type: string,
    property: string,
    signature?: string,
  }) {
  // Generate anchor ID for types (e.g., currentUser.id -> currentuserid)
  const typeName = type.replace(/[^a-z0-9]/gi, '').toLowerCase();
  const propertyName = property.replace(/[^a-z0-9]/gi, '').toLowerCase();
  const anchorId = `${typeName}${propertyName}`;

  // Always start with defaultOpen to avoid hydration mismatches
  const [isOpen, setIsOpen] = useState(defaultOpen);

    // Listen for hash changes and auto-open matching sections
    useEffect(() => {
      const handleHashChange = () => {
        const hash = window.location.hash.replace('#', '');
        if (hash === anchorId) {
          setIsOpen(true);
          // Small delay to ensure the section is opened before scrolling
          setTimeout(() => {
            const element = document.getElementById(anchorId);
            if (element) {
              element.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
          }, 100);
        }
      };

      // Check on mount (after hydration)
      handleHashChange();

      // Listen for hash changes
      window.addEventListener('hashchange', handleHashChange);
      return () => window.removeEventListener('hashchange', handleHashChange);
    }, [anchorId]);

    // Full display name with optional signature (e.g., "currentUser.leaveTeam(team)" or "currentUser.id")
    const fullName = signature
      ? `${type ? `${type}.` : ''}${property}(${signature})`
      : `${type ? `${type}.` : ''}${property}`;

    // Type-based styling for different object types
    const getTypeStyle = (typeName: string) => {
      switch (typeName.toLowerCase()) {
        case 'currentuser': {
          return 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300';
        }
        case 'serveruser': {
          return 'bg-violet-50 dark:bg-violet-950/50 text-violet-700 dark:text-violet-300';
        }
        case 'currentserveruser': {
          return 'bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300';
        }
        case 'team': {
          return 'bg-orange-50 dark:bg-orange-950/50 text-orange-700 dark:text-orange-300';
        }
        case 'serverteam': {
          return 'bg-amber-50 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300';
        }
        case 'teamuser': {
          return 'bg-pink-50 dark:bg-pink-950/50 text-pink-700 dark:text-pink-300';
        }
        case 'teampermission': {
          return 'bg-purple-50 dark:bg-purple-950/50 text-purple-700 dark:text-purple-300';
        }
        case 'teamprofile': {
          return 'bg-indigo-50 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300';
        }
        case 'contactchannel': {
          return 'bg-cyan-50 dark:bg-cyan-950/50 text-cyan-700 dark:text-cyan-300';
        }
        case 'apikey': {
          return 'bg-teal-50 dark:bg-teal-950/50 text-teal-700 dark:text-teal-300';
        }
        case 'project': {
          return 'bg-lime-50 dark:bg-lime-950/50 text-lime-700 dark:text-lime-300';
        }
        default: {
          return 'bg-gray-50 dark:bg-gray-950/50 text-gray-700 dark:text-gray-300';
        }
      }
    };

    return (
      <div className={cn(
        'border border-fd-border rounded-lg bg-gradient-to-br from-fd-card/20 to-fd-card/30 mb-2',
        className
      )}>
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-fd-accent/5 transition-colors rounded-t-lg"
        >
          <div className="flex items-center gap-1.5">
            <div id={anchorId} className="text-m font-medium text-fd-foreground font-mono scroll-mt-20 leading-none">
              {fullName}
            </div>
          </div>

          <div className="flex items-center gap-2">
            {type && (
              <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${getTypeStyle(type)}`}>
                {type}
              </span>
            )}
            {isOpen ? (
              <ChevronDown className="w-3 h-3 text-fd-muted-foreground transition-transform" />
            ) : (
              <ChevronRight className="w-3 h-3 text-fd-muted-foreground transition-transform" />
            )}
          </div>
        </button>

        <div
          className={cn(
            'transition-all duration-300 ease-in-out overflow-hidden',
            isOpen ? 'max-h-[2000px] opacity-100' : 'max-h-0 opacity-0'
          )}
        >
          <div className="border-t border-fd-border/50">
            <div className="p-3">
              {children}
            </div>
          </div>
        </div>
      </div>
    );
}
