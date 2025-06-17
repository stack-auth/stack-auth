'use client';

import { useTheme } from 'next-themes';
import { useEffect, useId, useRef, useState } from 'react';

export function Mermaid({ chart }: { chart: string }) {
  const id = useId();
  const [svg, setSvg] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const currentChartRef = useRef<string | null>(null);
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    const container = containerRef.current;
    if (currentChartRef.current === chart || !container) return;
    currentChartRef.current = chart;

    async function renderChart() {
      const { default: mermaid } = await import('mermaid');

      try {
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'loose',
          fontFamily: 'inherit',
          theme: resolvedTheme === 'dark' ? 'dark' : 'default',
        });
        const { svg, bindFunctions } = await mermaid.render(
          id,
          chart.replaceAll('\\n', '\n'),
        );

        bindFunctions?.(container!);

        // Add padding to the SVG to prevent cut-off
        const modifiedSvg = svg.replace(
          /<svg([^>]*)>/,
          '<svg$1 style="padding: 20px;">'
        );

        setSvg(modifiedSvg);
      } catch (error) {
        console.error('Error while rendering mermaid', error);
      }
    }

    renderChart().catch(error => {
      console.error('Failed to render Mermaid chart:', error);
    });
  }, [chart, id, resolvedTheme]);

  return (
    <div
      ref={containerRef}
      className="my-6 pb-4 overflow-x-auto flex justify-center"
      dangerouslySetInnerHTML={{ __html: svg }}
      style={{
        minHeight: 'fit-content',
      }}
    />
  );
}
