'use client';

import { useEffect, useState } from "react";
import { codeToHtml } from "shiki";

type DynamicCodeblockProps = {
  code: string,
  language?: string,
  title?: string,
}

export function DynamicCodeblock({ code, language = 'tsx', title }: DynamicCodeblockProps) {
  const [highlightedCode, setHighlightedCode] = useState<string>("");

  // Update syntax highlighted code when code changes
  useEffect(() => {
    const updateHighlightedCode = async () => {
      try {
        const html = await codeToHtml(code, {
          lang: language,
          theme: 'github-dark',
          transformers: [{
            pre(node) {
              // Remove background styles from pre element
              if (node.properties.style) {
                node.properties.style = (node.properties.style as string).replace(/background[^;]*;?/g, '');
              }
            },
            code(node) {
              // Remove background styles from code element
              if (node.properties.style) {
                node.properties.style = (node.properties.style as string).replace(/background[^;]*;?/g, '');
              }
            }
          }]
        });
        setHighlightedCode(html);
      } catch (error) {
        console.error('Error highlighting code:', error);
        setHighlightedCode(`<pre><code>${code}</code></pre>`);
      }
    };

    updateHighlightedCode().catch(error => {
      console.error('Error updating highlighted code:', error);
    });
  }, [code, language]);

  return (
    <div className="space-y-4">
      {title && <h3 className="text-lg font-semibold">{title}</h3>}
      <div className="relative">
        <div
          className="rounded-lg border bg-[#0a0a0a] p-4 overflow-auto max-h-[500px] text-sm"
          style={{
            background: '#0a0a0a !important',
          }}
        >
          <div
            className="[&_*]:!bg-transparent [&_pre]:!bg-transparent [&_code]:!bg-transparent"
            dangerouslySetInnerHTML={{ __html: highlightedCode }}
          />
        </div>
      </div>
    </div>
  );
}
