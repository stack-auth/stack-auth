'use client';

import { Command, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { cn } from '../../lib/cn';

function getSearchKey() {
  if (typeof window === 'undefined') return 'mac';
  return navigator.platform.toLowerCase().includes('mac') ? 'mac' : 'ctrl';
}

// Compact search button - perfect for navbars
export function CustomSearchToggle({ onOpen, className }: {
  onOpen: () => void,
  className?: string,
}) {
  const [searchKey, setSearchKey] = useState('mac');

  useEffect(() => {
    setSearchKey(getSearchKey());
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        onOpen();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onOpen]);

  return (
    <button
      onClick={onOpen}
      className={cn(
        'group relative inline-flex h-9 items-center gap-2 rounded-lg border border-fd-border/60 bg-fd-background/50 px-3 text-sm text-fd-muted-foreground backdrop-blur-sm transition-all duration-200 hover:border-fd-border hover:bg-fd-background hover:text-fd-foreground hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-fd-primary/20',
        className
      )}
    >
      <Search className="h-4 w-4 transition-colors" />
      <span className="hidden sm:inline">Search...</span>
      {searchKey && (
        <div className="hidden md:flex items-center gap-1">
          <kbd className="inline-flex h-5 min-w-[20px] items-center justify-center rounded border border-fd-border/60 bg-fd-muted/50 px-1 font-mono text-[11px] font-medium text-fd-muted-foreground/80 transition-colors group-hover:border-fd-border group-hover:bg-fd-muted group-hover:text-fd-muted-foreground">
            {searchKey === 'mac' ? (
              <Command className="h-3 w-3" />
            ) : (
              'Ctrl'
            )}
          </kbd>
          <kbd className="inline-flex h-5 w-5 items-center justify-center rounded border border-fd-border/60 bg-fd-muted/50 font-mono text-[11px] font-medium text-fd-muted-foreground/80 transition-colors group-hover:border-fd-border group-hover:bg-fd-muted group-hover:text-fd-muted-foreground">
            K
          </kbd>
        </div>
      )}
    </button>
  );
}

// Minimal icon-only search button - for tight spaces
export function CompactSearchToggle({ onOpen, className }: {
  onOpen: () => void,
  className?: string,
}) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        onOpen();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onOpen]);

  return (
    <button
      onClick={onOpen}
      className={cn(
        'inline-flex h-9 w-9 items-center justify-center rounded-lg text-fd-muted-foreground transition-colors hover:bg-fd-muted hover:text-fd-foreground focus:outline-none focus:ring-2 focus:ring-fd-primary/20',
        className
      )}
      title="Search documentation"
    >
      <Search className="h-4 w-4" />
    </button>
  );
}

// Enhanced search input-style button - looks like a search field
export function SearchInputToggle({ onOpen, className }: {
  onOpen: () => void,
  className?: string,
}) {
  const [searchKey, setSearchKey] = useState('mac');

  useEffect(() => {
    setSearchKey(getSearchKey());
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        onOpen();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onOpen]);

  return (
    <button
      onClick={onOpen}
      className={cn(
        'group flex h-9 w-full items-center justify-center rounded-lg border border-fd-border/60 bg-fd-background/50 text-sm text-fd-muted-foreground backdrop-blur-sm transition-all duration-200 hover:border-fd-border hover:bg-fd-background hover:text-fd-foreground hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-fd-primary/20',
        // On small containers (mobile), center the icon
        'sm:justify-start sm:gap-3 sm:px-3',
        className
      )}
    >
      <Search className="h-4 w-4 flex-shrink-0 transition-colors" />
      {/* Text - hidden on very small containers, shown when there's space */}
      <span className="hidden sm:block truncate">
        <span className="hidden md:inline">Search documentation...</span>
        <span className="sm:inline md:hidden">Search...</span>
      </span>
      {/* Keyboard shortcut - only shown on larger containers */}
      {searchKey && (
        <div className="hidden md:flex items-center gap-1 ml-auto">
          <kbd className="inline-flex h-6 min-w-[24px] items-center justify-center rounded-md border border-fd-border/60 bg-fd-muted/50 px-1.5 font-mono text-xs font-semibold text-fd-muted-foreground/90 transition-colors group-hover:border-fd-border group-hover:bg-fd-muted group-hover:text-fd-muted-foreground">
            {searchKey === 'mac' ? (
              <Command className="h-3.5 w-3.5" />
            ) : (
              'Ctrl'
            )}
          </kbd>
          <kbd className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-fd-border/60 bg-fd-muted/50 font-mono text-xs font-semibold text-fd-muted-foreground/90 transition-colors group-hover:border-fd-border group-hover:bg-fd-muted group-hover:text-fd-muted-foreground">
            K
          </kbd>
        </div>
      )}
    </button>
  );
}

// Large prominent search toggle - for hero sections or main content areas
export function LargeCustomSearchToggle({ onOpen, className }: {
  onOpen: () => void,
  className?: string,
}) {
  const [searchKey, setSearchKey] = useState('mac');

  useEffect(() => {
    setSearchKey(getSearchKey());
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        onOpen();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onOpen]);

  return (
    <button
      onClick={onOpen}
      className={cn(
        'group flex w-full items-center gap-4 rounded-xl border border-fd-border/60 bg-fd-background/80 px-4 py-4 text-left text-sm text-fd-muted-foreground backdrop-blur-sm transition-all duration-200 hover:border-fd-border hover:bg-fd-background hover:text-fd-foreground hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-fd-primary/20',
        className
      )}
    >
      <Search className="h-5 w-5 flex-shrink-0 transition-colors" />
      <div className="flex-1">
        <div className="font-medium">Search documentation</div>
        <div className="text-xs text-fd-muted-foreground/70">Find guides, API references, and examples</div>
      </div>
      {searchKey && (
        <div className="flex items-center gap-1">
          <kbd className="inline-flex h-7 min-w-[28px] items-center justify-center rounded-md border border-fd-border/60 bg-fd-muted/50 px-2 font-mono text-xs font-medium text-fd-muted-foreground/80 transition-colors group-hover:border-fd-border group-hover:bg-fd-muted group-hover:text-fd-muted-foreground">
            {searchKey === 'mac' ? (
              <Command className="h-4 w-4" />
            ) : (
              'Ctrl'
            )}
          </kbd>
          <kbd className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-fd-border/60 bg-fd-muted/50 font-mono text-xs font-medium text-fd-muted-foreground/80 transition-colors group-hover:border-fd-border group-hover:bg-fd-muted group-hover:text-fd-muted-foreground">
            K
          </kbd>
        </div>
      )}
    </button>
  );
}
