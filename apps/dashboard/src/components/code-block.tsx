'use client';

import { useThemeWatcher } from '@/lib/theme';
import { CopyButton, SimpleTooltip } from "@stackframe/stack-ui";
import { Code, Terminal } from "lucide-react";
import { PrismLight as SyntaxHighlighter } from 'react-syntax-highlighter';
import bash from 'react-syntax-highlighter/dist/esm/languages/prism/bash';
import python from 'react-syntax-highlighter/dist/esm/languages/prism/python';
import tsx from 'react-syntax-highlighter/dist/esm/languages/prism/tsx';
import typescript from 'react-syntax-highlighter/dist/esm/languages/prism/typescript';
import { dark, prism } from 'react-syntax-highlighter/dist/esm/styles/prism';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

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
    <div className={cn("bg-muted overflow-hidden", !props.fullWidth && "rounded-xl")}>
      <div className={cn("text-muted-foreground font-medium py-2 pl-4 pr-2 border-b dark:border-black text-sm flex justify-between items-center", props.compact && "py-1")}>
        <h5 className={cn("font-medium flex items-center gap-2", props.compact && "text-xs")}>
          {icon}
          {props.title}
        </h5>
        <div className="flex items-center gap-2">
          {props.tooltip && (
            <SimpleTooltip type="info" tooltip={props.tooltip} />
          )}
          <CopyButton content={props.content} />
        </div>
      </div>
      <div>
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
            ...(props.compact && {
              padding: '0.75em',
              fontSize: '0.75rem',
            }),
          }}
          wrapLines
        >
          {props.content}
        </SyntaxHighlighter>}
      </div>
    </div>
  );
}
