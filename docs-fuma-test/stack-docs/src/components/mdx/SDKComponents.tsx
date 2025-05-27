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
    <details className="accordion">
      <summary className="accordion-title">{title}</summary>
      <div className="accordion-content">{children}</div>
    </details>
  );
}

export function CodeBlocks({ children }: { children: React.ReactNode }) {
  return <div className="code-blocks">{children}</div>;
}

export function Icon({ icon }: { icon: string }) {
  // Simple icon placeholder - you can integrate with your icon system later
  return <span className={`icon ${icon}`} />;
} 
