import React from 'react';
import { cn } from '../lib/cn';

export type PropDefinition = {
  name: string,
  type: string,
  description: string,
  optional?: boolean,
  default?: string,
  nested?: PropDefinition[],
}

export type PropTableProps = {
  props: PropDefinition[],
  className?: string,
}

export function PropTable({ props, className }: PropTableProps) {
  const renderProp = (prop: PropDefinition, level: number = 0) => {
    const isNested = level > 0;

    return (
      <React.Fragment key={`${prop.name}-${level}`}>
        <tr className={cn(
          "border-b border-fd-border",
          isNested && "bg-fd-muted/30"
        )}>
          <td className="py-3 px-4 font-mono text-sm">
            <div className="flex items-center gap-2">
              {isNested && (
                <div className="flex items-center text-fd-muted-foreground/60">
                  {/* Create visual indentation with improved spacing */}
                  <div className="flex items-center" style={{ marginLeft: `${(level - 1) * 16}px` }}>
                    <div className="w-6 h-4 flex items-center justify-start">
                      <div className="w-3 h-px bg-fd-muted-foreground/40"></div>
                    </div>
                    <div className="w-1 h-1 bg-fd-muted-foreground/60 rounded-full mr-2"></div>
                  </div>
                </div>
              )}
              <code className={cn(
                isNested ? "text-sm font-medium text-fd-muted-foreground" : "font-semibold text-fd-primary",
                isNested && "italic"
              )}>
                {prop.name}
              </code>
              {prop.optional && (
                <span className={cn(
                  "text-xs px-1.5 py-0.5 rounded",
                  isNested
                    ? "text-fd-muted-foreground/80 bg-fd-muted/60"
                    : "text-fd-muted-foreground bg-fd-muted"
                )}>
                  optional
                </span>
              )}
            </div>
          </td>
          <td className="py-3 px-4">
            <code className={cn(
              "text-sm px-2 py-1 rounded",
              isNested
                ? "bg-fd-muted/40 text-fd-muted-foreground/90 text-xs"
                : "bg-fd-muted text-fd-accent-foreground"
            )}>
              {prop.type}
            </code>
          </td>
          <td className="py-3 px-4 text-sm">
            {prop.default && (
              <code className={cn(
                "px-2 py-1 rounded mr-2",
                isNested
                  ? "bg-fd-muted/40 text-fd-muted-foreground/90 text-xs"
                  : "bg-fd-muted text-fd-muted-foreground"
              )}>
                {prop.default}
              </code>
            )}
            {!prop.default && (
              <span className="text-fd-muted-foreground">—</span>
            )}
          </td>
          <td className={cn(
            "py-3 px-4 text-sm",
            isNested ? "text-fd-muted-foreground/90 text-xs" : "text-fd-foreground"
          )}>
            {prop.description}
          </td>
        </tr>
        {prop.nested?.map(nestedProp => renderProp(nestedProp, level + 1))}
      </React.Fragment>
    );
  };

  return (
    <div className={cn("my-6 overflow-hidden rounded-lg", className)}>
      <table className="w-full border-collapse">
        <thead>
          <tr className="bg-fd-muted/50 border-b border-fd-border">
            <th className="py-3 px-4 text-left text-sm font-semibold text-fd-foreground">
              Prop
            </th>
            <th className="py-3 px-4 text-left text-sm font-semibold text-fd-foreground">
              Type
            </th>
            <th className="py-3 px-4 text-left text-sm font-semibold text-fd-foreground">
              Default
            </th>
            <th className="py-3 px-4 text-left text-sm font-semibold text-fd-foreground">
              Description
            </th>
          </tr>
        </thead>
        <tbody>
          {props.map(prop => renderProp(prop))}
        </tbody>
      </table>
    </div>
  );
}
