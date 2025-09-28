import { cn } from "@/lib/utils";
import { useAsyncCallback } from "@stackframe/stack-shared/dist/hooks/use-async-callback";
import { throwErr } from "@stackframe/stack-shared/dist/utils/errors";
import { Button, Input } from "@stackframe/stack-ui";
import { Check, X } from "lucide-react";
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

  return <div
    className="flex items-center relative"
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
      // prevent blur from happening
      ev.preventDefault();
      return false;
    }}
  >
    <Input
      type={mode === 'password' ? 'password' : 'text'}
      ref={inputRef}
      readOnly={readOnly}
      disabled={isLoading}
      placeholder={placeholder}
      tabIndex={readOnly ? -1 : undefined}
      className={cn(
        "w-full px-1 py-0 h-[unset] border-transparent",
        /* Hover */ !readOnly && "hover:ring-1 hover:ring-slate-300 dark:hover:ring-gray-500 hover:bg-slate-50 dark:hover:bg-gray-800 hover:cursor-pointer",
        /* Focus */ !readOnly && "focus:cursor-[unset] focus-visible:ring-slate-500 dark:focus-visible:ring-gray-50 focus-visible:bg-slate-100 dark:focus-visible:bg-gray-800",
        readOnly && "focus-visible:ring-0 cursor-default",
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
    <div className="flex gap-2" style={{
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
            "min-h-5 min-w-5 h-5 w-5 rounded-full flex items-center justify-center",
            action === "accept" ? "bg-green-500 active:bg-green-600" : "bg-red-500 active:bg-red-600"
          )}
          onClick={async () => {
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
          }}
        >
          {action === "accept" ?
            <Check size={15} className="text-white dark:text-black" /> :
            <X size={15} className="text-white dark:text-black" />}
        </Button>
      ))}
    </div>
  </div>;
}
