'use client';

import { CopyButton, SimpleTooltip } from "@/components/ui";
import { useThemeWatcher } from '@/lib/theme';
import { cn } from '@/lib/utils';
import { CodeIcon, TerminalWindowIcon } from "@phosphor-icons/react";
import type { CSSProperties, ReactNode } from 'react';
import { PrismLight as SyntaxHighlighter } from 'react-syntax-highlighter';
import bash from 'react-syntax-highlighter/dist/esm/languages/prism/bash';
import python from 'react-syntax-highlighter/dist/esm/languages/prism/python';
import sql from 'react-syntax-highlighter/dist/esm/languages/prism/sql';
import tsx from 'react-syntax-highlighter/dist/esm/languages/prism/tsx';
import typescript from 'react-syntax-highlighter/dist/esm/languages/prism/typescript';

Object.entries({ tsx, bash, typescript, python, sql }).forEach(([key, value]) => {
  SyntaxHighlighter.registerLanguage(key, value);
});

const codeThemeBase: Record<string, CSSProperties> = {
  'code[class*="language-"]': {
    background: 'transparent',
    fontFamily: 'Consolas, Monaco, "Andale Mono", "Ubuntu Mono", monospace',
    textShadow: 'none',
  },
  'pre[class*="language-"]': {
    background: 'transparent',
    fontFamily: 'Consolas, Monaco, "Andale Mono", "Ubuntu Mono", monospace',
    textShadow: 'none',
  },
};

const lightCodeTheme: Record<string, CSSProperties> = {
  ...codeThemeBase,
  'code[class*="language-"]': {
    ...codeThemeBase['code[class*="language-"]'],
    color: '#334155',
  },
  'pre[class*="language-"]': {
    ...codeThemeBase['pre[class*="language-"]'],
    color: '#334155',
  },
  comment: { color: '#94a3b8', fontStyle: 'italic' },
  punctuation: { color: '#475569' },
  property: { color: '#075985' },
  tag: { color: '#1d4ed8' },
  boolean: { color: '#b45309', fontWeight: 600 },
  number: { color: '#b45309', fontWeight: 600 },
  constant: { color: '#6d28d9', fontWeight: 600 },
  selector: { color: '#047857' },
  string: { color: '#047857' },
  builtin: { color: '#0e7490', fontWeight: 600 },
  operator: { color: '#0f766e', fontWeight: 600 },
  variable: { color: '#334155' },
  atrule: { color: '#6d28d9', fontWeight: 600 },
  function: { color: '#1d4ed8', fontWeight: 600 },
  'class-name': { color: '#a16207', fontWeight: 600 },
  keyword: { color: '#6d28d9', fontWeight: 600 },
};

const darkCodeTheme: Record<string, CSSProperties> = {
  ...codeThemeBase,
  'code[class*="language-"]': {
    ...codeThemeBase['code[class*="language-"]'],
    color: '#eef6ff',
  },
  'pre[class*="language-"]': {
    ...codeThemeBase['pre[class*="language-"]'],
    color: '#eef6ff',
  },
  comment: { color: '#7c8798', fontStyle: 'italic' },
  punctuation: { color: '#c6d3e1' },
  property: { color: '#38bdf8' },
  tag: { color: '#60a5fa' },
  boolean: { color: '#fbbf24', fontWeight: 600 },
  number: { color: '#fbbf24', fontWeight: 600 },
  constant: { color: '#d8b4fe', fontWeight: 600 },
  selector: { color: '#4ade80' },
  string: { color: '#4ade80' },
  builtin: { color: '#22d3ee', fontWeight: 600 },
  operator: { color: '#22d3ee', fontWeight: 600 },
  variable: { color: '#eef6ff' },
  atrule: { color: '#d8b4fe', fontWeight: 600 },
  function: { color: '#60a5fa', fontWeight: 600 },
  'class-name': { color: '#fde047', fontWeight: 600 },
  keyword: { color: '#d8b4fe', fontWeight: 600 },
};

type CodeBlockProps = {
  language: string,
  content: string,
  customRender?: ReactNode,
  title: string,
  icon: 'terminal' | 'code',
  maxHeight?: number,
  compact?: boolean,
  tooltip?: ReactNode,
  fullWidth?: boolean,
  neutralBackground?: boolean,
  noSeparator?: boolean,
};

export function CodeBlock(props: CodeBlockProps) {
  const { theme } = useThemeWatcher();

  let icon = null;
  switch (props.icon) {
    case 'terminal': {
      icon = <TerminalWindowIcon className={cn("w-4 h-4", props.compact && "w-3 h-3")} />;
      break;
    }
    case 'code': {
      icon = <CodeIcon className={cn("w-4 h-4", props.compact && "w-3 h-3")} />;
      break;
    }
  }

  return (
    <div className={cn(
      "overflow-hidden transition-all duration-150 hover:transition-none",
      !props.fullWidth && "rounded-xl",
      props.neutralBackground
        ? "bg-background border border-black/[0.08] dark:border-white/[0.06] shadow-sm"
        : "bg-white/90 dark:bg-background/60 dark:backdrop-blur-xl ring-1 ring-black/[0.06] hover:ring-black/[0.1] dark:ring-white/[0.06] dark:hover:ring-white/[0.1] shadow-none border border-black/[0.06] dark:border-white/[0.06]"
    )}>
      <div className={cn(
        "text-muted-foreground font-medium pl-4 pr-2 text-sm flex justify-between items-center bg-black/[0.015] dark:bg-white/[0.015]",
        props.compact && !props.noSeparator && "py-1.5",
        !props.compact && !props.noSeparator && "py-2.5",
        props.noSeparator && "pt-1 pb-0",
        !props.noSeparator && "border-b border-black/[0.06] dark:border-white/[0.06]"
      )}>
        <h5 className={cn("font-medium flex items-center gap-2", props.compact && "text-xs")}>
          {icon}
          {props.title}
        </h5>
        <div className="flex items-center gap-2">
          {props.tooltip && (
            <SimpleTooltip type="info" tooltip={props.tooltip} />
          )}
          <CopyButton content={props.content} variant={props.neutralBackground ? "ghost" : "secondary"} />
        </div>
      </div>
      <div className="overflow-x-auto">
        {props.customRender ?? <SyntaxHighlighter
          language={props.language}
          style={theme === 'dark' ? darkCodeTheme : lightCodeTheme}
          customStyle={{
            background: 'transparent',
            padding: '1em',
            border: 0,
            boxShadow: 'none',
            margin: 0,
            fontSize: '0.875rem',
            maxHeight: props.maxHeight,
            overflow: 'auto',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            ...(props.compact && {
              padding: '0.75em',
              fontSize: '0.75rem',
            }),
          }}
          wrapLines
          wrapLongLines
        >
          {props.content}
        </SyntaxHighlighter>}
      </div>
    </div>
  );
}
