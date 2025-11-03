'use client';

import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';
import { UserButton } from '@stackframe/stack';
import { BookOpen } from 'lucide-react';
import { useTheme } from 'next-themes';

import { Link } from './link';
import { Logo } from './logo';

type NavbarProps = {
  className?: string;
  title?: string;
  subtitle?: string;
  showDocs?: boolean;
  children?: ReactNode;
};

export function Navbar({
  className,
  title = 'Dashboard',
  subtitle = 'Stack Auth',
  showDocs = true,
  children,
}: NavbarProps) {
  const { resolvedTheme, setTheme } = useTheme();

  if (children) {
    return (
      <header className={cn('flex w-full items-center justify-between px-4 py-2', className)}>
        {children}
      </header>
    );
  }

  const navbarClassName = cn(
    'relative flex items-center justify-between rounded-[24px] border border-white/40 bg-white/70 px-5 py-3 shadow-[0_20px_40px_rgba(15,23,42,0.14)] backdrop-blur-xl transition-all dark:border-white/10 dark:bg-white/10',
    className,
  );

  return (
    <header className={navbarClassName}>
      <div className="flex items-center gap-3">
        <Logo
          full
          height={24}
          href="/projects"
          className="drop-shadow-[0px_6px_16px_rgba(59,130,246,0.35)]"
        />
        <div className="flex flex-col leading-tight">
          <span className="text-[11px] uppercase tracking-[0.28em] text-slate-500/80 dark:text-slate-300/60">
            {subtitle}
          </span>
          <span className="text-base font-semibold text-slate-900 dark:text-slate-100">
            {title}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-2">
        {showDocs && (
          <Link
            href="https://docs.stack-auth.com/"
            className="flex items-center gap-1 rounded-full border border-white/70 bg-white/75 px-3 py-1 text-xs font-medium text-slate-700 shadow-[0_10px_24px_rgba(15,23,42,0.1)] transition hover:shadow-[0_14px_32px_rgba(15,23,42,0.16)] dark:border-white/10 dark:bg-white/10 dark:text-slate-200/80"
          >
            <BookOpen size={14} className="text-slate-500 dark:text-slate-300" />
            Docs
          </Link>
        )}

        <div className="rounded-full border border-white/70 bg-white/80 p-1 shadow-[0_10px_28px_rgba(37,99,235,0.28)] transition hover:shadow-[0_14px_36px_rgba(37,99,235,0.32)] dark:border-white/10 dark:bg-white/10">
          <UserButton colorModeToggle={() => setTheme(resolvedTheme === 'light' ? 'dark' : 'light')} />
        </div>
      </div>
    </header>
  );
}
