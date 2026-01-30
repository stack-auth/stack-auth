import { Button, Input } from "@/components/ui";
import { cn } from "@/lib/utils";
import { Check, X } from "@phosphor-icons/react";
import { useAsyncCallback } from "@stackframe/stack-shared/dist/hooks/use-async-callback";
import { runAsynchronouslyWithAlert } from "@stackframe/stack-shared/dist/utils/promises";
import { throwErr } from "@stackframe/stack-shared/dist/utils/errors";
import { useRef, useState } from "react";


type EditableInputProps = {
  value: string,
  initialEditValue?: string | undefined,
  onUpdate?: (value: string) => Promise<void>,
  readOnly?: boolean,
  placeholder?: string,
  inputClassName?: string,
  shiftTextToLeft?: boolean,
  mode?: 'text' | 'password',
};

export function EditableInput({
  value,
  initialEditValue,
  onUpdate,
  readOnly,
  placeholder,
  inputClassName,
  shiftTextToLeft,
  mode = 'text',
}: EditableInputProps) {
  const [editValue, setEditValue] = useState<string | null>(null);
  const editing = editValue !== null;
  const [hasChanged, setHasChanged] = useState(false);

  const forceAllowBlur = useRef(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const acceptRef = useRef<HTMLButtonElement>(null);

  const [handleUpdate, isLoading] = useAsyncCallback(async (value: string) => {
    await onUpdate?.(value);
  }, [onUpdate]);

  const containerRef = useRef<HTMLDivElement>(null);

  return <div
    ref={containerRef}
    className="flex items-center relative w-full"
    onFocus={() => {
      if (!readOnly) {
        setEditValue(editValue ?? initialEditValue ?? value);
      }
    }}
    onBlur={(ev) => {
      if (!forceAllowBlur.current) {
        if (!hasChanged) {
          setEditValue(null);
        } else {
          // TODO this should probably be a blocking dialog instead, and it should have a "cancel" button that focuses the input again
          if (confirm("You have unapplied changes. Would you like to save them?")) {
            acceptRef.current?.click();
          } else {
            setEditValue(null);
            setHasChanged(false);
          }
        }
      }
    }}
    onMouseDown={(ev) => {
      // Prevent blur when clicking on buttons inside the container (except input, which has stopPropagation).
      // This keeps focus on input while user clicks accept/reject buttons.
      if (containerRef.current?.contains(ev.target as Node)) {
        ev.preventDefault();
        return false;
      }
    }}
  >
    <Input
      type={mode === 'password' ? 'password' : 'text'}
      ref={inputRef}
      readOnly={readOnly}
      disabled={isLoading}
      placeholder={placeholder}
      tabIndex={readOnly ? -1 : undefined}
      size="sm"
      className={cn(
        "w-full px-3 h-8",
        /* Hover */ !readOnly && "hover:cursor-pointer",
        /* Focus */ !readOnly && "focus:cursor-[unset]",
        readOnly && "focus-visible:ring-0 cursor-default text-muted-foreground",
        shiftTextToLeft && "ml-[-7px]",
        inputClassName,
      )}
      value={editValue ?? value}
      autoComplete="off"
      style={{
        textOverflow: "ellipsis",
      }}
      onChange={(e) => {
        setEditValue(e.target.value);
        setHasChanged(true);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          acceptRef.current?.click();
        }
      }}
      onMouseDown={(ev) => {
        // parent prevents mousedown, so we stop it here
        ev.stopPropagation();
      }}
    />
    <div className="flex gap-1" style={{
      overflow: "hidden",
      width: editing ? "4rem" : 0,
      marginLeft: editing ? "0.5rem" : 0,
      opacity: editing ? 1 : 0,
      transition: "width 0.2s ease-in-out, margin-left 0.2s ease-in-out, opacity 0.2s ease-in-out",
    }}>
      {["accept", "reject"].map((action) => (
        <Button
          ref={action === "accept" ? acceptRef : undefined}
          key={action}
          disabled={isLoading}
          type="button"
          variant="plain"
          size="plain"
          className={cn(
            "h-7 w-7 rounded-lg flex items-center justify-center transition-all duration-150 hover:transition-none backdrop-blur-sm",
            action === "accept"
              ? "bg-emerald-500/[0.08] text-emerald-600 dark:text-emerald-400 ring-1 ring-emerald-500/20 hover:bg-emerald-500/[0.15] hover:ring-emerald-500/30"
              : "bg-red-500/[0.08] text-red-600 dark:text-red-400 ring-1 ring-red-500/20 hover:bg-red-500/[0.15] hover:ring-red-500/30"
          )}
          onClick={() => runAsynchronouslyWithAlert(async () => {
            try {
              forceAllowBlur.current = true;
              inputRef.current?.blur();
              if (action === "accept") {
                await handleUpdate(editValue ?? throwErr("No value to update"));
              }
              setEditValue(null);
              setHasChanged(false);
            } finally {
              forceAllowBlur.current = false;
            }
          })}
        >
          {action === "accept" ?
            <Check weight="bold" className="h-3.5 w-3.5" /> :
            <X weight="bold" className="h-3.5 w-3.5" />}
        </Button>
      ))}
    </div>
  </div>;
}
