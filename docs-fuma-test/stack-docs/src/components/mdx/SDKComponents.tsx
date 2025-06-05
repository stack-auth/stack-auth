import React from 'react';

// SDK Documentation Components
export function Markdown({ src }: { src: string }) {
  // For now, just render a placeholder - you can implement actual markdown loading later
  return <div className="markdown-include" data-src={src} />;
}

export function ParamField({ 
  path, 
  type, 
  required, 
  children 
}: { 
  path: string; 
  type: string; 
  required?: boolean; 
  children: React.ReactNode;
}) {
  return (
    <div className="param-field">
      <div className="param-header">
        <code className="param-path">{path}</code>
        <span className="param-type">{type}</span>
        {required && <span className="param-required">required</span>}
      </div>
      <div className="param-description">{children}</div>
    </div>
  );
}

export function Accordion({ title, children }: { title: React.ReactNode; children: React.ReactNode }) {
  return (
    <details className="group border border-fd-border rounded-lg bg-fd-card">
      <summary className="flex items-center justify-between px-4 py-3 cursor-pointer font-medium text-fd-foreground hover:bg-fd-accent/50 rounded-lg list-none [&::-webkit-details-marker]:hidden">
        {title}
        <svg 
          className="w-4 h-4 transition-transform group-open:rotate-180" 
          fill="none" 
          stroke="currentColor" 
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </summary>
      <div className="px-4 pb-4 text-fd-muted-foreground">
        {children}
      </div>
    </details>
  );
}

export function AccordionGroup({ children }: { children: React.ReactNode }) {
  return (
    <div className="accordion-group space-y-3 mb-6">
      {children}
    </div>
  );
}

export function CodeBlocks({ children }: { children: React.ReactNode }) {
  return <div className="code-blocks">{children}</div>;
}

export function Icon({ icon }: { icon: string }) {
  // Simple icon placeholder - you can integrate with your icon system later
  return <span className={`icon ${icon}`} />;
} 
