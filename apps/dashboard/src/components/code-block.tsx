'use client';

import { useThemeWatcher } from '@/lib/theme';
import { cn } from '@/lib/utils';
import { CopyButton, SimpleTooltip } from "@stackframe/stack-ui";
import { Code, Terminal } from "lucide-react";
import type { ReactNode } from 'react';
import { PrismLight as SyntaxHighlighter } from 'react-syntax-highlighter';
import bash from 'react-syntax-highlighter/dist/esm/languages/prism/bash';
import python from 'react-syntax-highlighter/dist/esm/languages/prism/python';
import tsx from 'react-syntax-highlighter/dist/esm/languages/prism/tsx';
import typescript from 'react-syntax-highlighter/dist/esm/languages/prism/typescript';
import { dark, prism } from 'react-syntax-highlighter/dist/esm/styles/prism';

Object.entries({ tsx, bash, typescript, python }).forEach(([key, value]) => {
  SyntaxHighlighter.registerLanguage(key, value);
});

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
  const { theme, mounted } = useThemeWatcher();

  let icon = null;
  switch (props.icon) {
    case 'terminal': {
      icon = <Terminal className={cn("w-4 h-4", props.compact && "w-3 h-3")} />;
      break;
    }
    case 'code': {
      icon = <Code className={cn("w-4 h-4", props.compact && "w-3 h-3")} />;
      break;
    }
  }

  return (
    <div className={cn("overflow-hidden", !props.fullWidth && "rounded-xl", props.neutralBackground ? "bg-background" : "bg-muted")}>
      <div className={cn("text-muted-foreground font-medium pl-4 pr-2 text-sm flex justify-between items-center", props.compact && !props.noSeparator && "py-1", !props.compact && !props.noSeparator && "py-2", props.noSeparator && "pt-1 pb-0", !props.noSeparator && "border-b")}>
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
          style={theme === 'dark' ? dark : prism}
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
