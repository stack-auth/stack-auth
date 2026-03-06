"use client";

import { Dialog, DialogContent, DialogHeader, DialogTitle, Input, Label, Tooltip, TooltipContent, TooltipTrigger, Typography } from "@/components/ui";
import { GearSix } from "@phosphor-icons/react";

// --- Dialog ---

export type TemplateVariablesDialogProps = {
  open: boolean,
  onOpenChange: (open: boolean) => void,
  variables: Record<string, string>,
  onVariablesChange: (variables: Record<string, string>) => void,
  isDirty?: boolean,
};

export function TemplateVariablesDialog({
  open,
  onOpenChange,
  variables,
  onVariablesChange,
  isDirty,
}: TemplateVariablesDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Template Variables</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 max-h-[400px] overflow-y-auto">
          {Object.entries(variables).map(([name, value]) => (
            <div key={name} className="space-y-1.5">
              <Label htmlFor={`var-${name}`} className="text-sm font-medium">{name}</Label>
              <Input
                id={`var-${name}`}
                value={value}
                onChange={(e) => onVariablesChange({ ...variables, [name]: e.target.value })}
              />
            </div>
          ))}
        </div>
        {isDirty && (
          <Typography variant="secondary" className="text-xs text-orange-500">
            Unsaved changes — save or click Next to persist.
          </Typography>
        )}
      </DialogContent>
    </Dialog>
  );
}

// --- Button ---

export type TemplateVariablesButtonProps = {
  isDirty?: boolean,
  onClick: () => void,
};

export function TemplateVariablesButton({ isDirty, onClick }: TemplateVariablesButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          className="h-full px-3 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/60 dark:hover:bg-foreground/[0.06] transition-colors duration-150 hover:transition-none border-l border-border/30 dark:border-foreground/[0.06]"
        >
          <GearSix size={14} weight={isDirty ? "fill" : "regular"} />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-xs">
        {isDirty ? "Template Variables (unsaved)" : "Template Variables"}
      </TooltipContent>
    </Tooltip>
  );
}
