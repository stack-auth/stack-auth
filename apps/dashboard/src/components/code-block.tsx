'use client';

import { useThemeWatcher } from '@/lib/theme';
import { CopyButton } from "@stackframe/stack-ui";
import { Code, Terminal } from "lucide-react";
import SyntaxHighlighter from 'react-syntax-highlighter';
import { atomOneDark, atomOneLight } from 'react-syntax-highlighter/dist/esm/styles/hljs';

export function CodeBlock(props: {
  language: string,
  content: string,
  title: string,
  icon: 'terminal' | 'code',
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
        <SyntaxHighlighter
          language={props.language}
          style={theme === 'dark' ? atomOneDark : atomOneLight}
          customStyle={{ background: 'transparent', paddingLeft: '1em', paddingRight: '1em', paddingTop: '0.75em', paddingBottom: '0.75em' }}
          wrapLines
        >
          {props.content}
        </SyntaxHighlighter>
      </div>
    </div>
  );
}
