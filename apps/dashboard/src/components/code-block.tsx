'use client';

import { useThemeWatcher } from '@/lib/theme';
import { CopyButton } from "@stackframe/stack-ui";
import { Code, Terminal } from "lucide-react";
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { dark, prism } from 'react-syntax-highlighter/dist/esm/styles/prism';

export function CodeBlock(props: {
  language: string,
  content: string,
  customRender?: React.ReactNode,
  title: string,
  icon: 'terminal' | 'code',
  maxHeight?: number,
}) {
  const { theme, mounted } = useThemeWatcher();

  let icon = null;
  switch (props.icon) {
    case 'terminal': {
      icon = <Terminal className="w-4 h-4" />;
      break;
    }
    case 'code': {
      icon = <Code className="w-4 h-4" />;
      break;
    }
  }

  return (
    <div className="bg-muted rounded-xl overflow-hidden">
      <div className="text-muted-foreground font-medium py-2 pl-4 pr-2 border-b dark:border-black text-sm flex justify-between items-center">
        <h5 className="font-medium flex items-center gap-2">
          {icon}
          {props.title}
        </h5>
        <CopyButton content={props.content} />
      </div>
      <div>
        {props.customRender ?? <SyntaxHighlighter
          language={props.language}
          style={theme === 'dark' ? dark : prism}
          customStyle={{ background: 'transparent', padding: '1em', border: 0, boxShadow: 'none', margin: 0, fontSize: '0.875rem', maxHeight: props.maxHeight, overflow: 'auto' }}
          wrapLines
        >
          {props.content}
        </SyntaxHighlighter>}
      </div>
    </div>
  );
}
