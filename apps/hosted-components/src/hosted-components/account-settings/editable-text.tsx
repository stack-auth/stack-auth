import { Button, Input } from "~/components/ui";

import { PencilSimple } from "@phosphor-icons/react";
import { useState } from "react";
import {
  getFieldClassName,
  getOutlineButtonClassName,
  getPrimaryButtonClassName,
  useDesign,
} from "./design-context";

export function EditableText(props: { value: string, onSave?: (value: string) => void | Promise<void> }) {
  const design = useDesign();
  const [editing, setEditing] = useState(false);
  const [editingValue, setEditingValue] = useState(props.value);
  const [saving, setSaving] = useState(false);

  return (
    <div className='flex items-center gap-2'>
      {editing ? (
        <>
          <Input
            value={editingValue}
            onChange={(e) => setEditingValue(e.target.value)}
            disabled={saving}
            className={getFieldClassName(design, "min-w-[200px]")}
          />
          <Button
            size='sm'
            onClick={async () => {
              setSaving(true);
              try {
                await props.onSave?.(editingValue);
                setEditing(false);
              } finally {
                setSaving(false);
              }
            }}
            loading={saving}
            className={getPrimaryButtonClassName(design, "px-4 transition-colors duration-150")}
          >
            Save
          </Button>
          <Button
            size='sm'
            variant='outline'
            disabled={saving}
            onClick={() => {
              setEditingValue(props.value);
              setEditing(false);
            }}
            className={getOutlineButtonClassName(design, "px-4 transition-colors duration-150")}
          >
            Cancel
          </Button>
        </>
      ) : (
        <>
          <span className="text-base font-medium text-foreground">{props.value}</span>
          <Button
            onClick={() => {
              setEditingValue(props.value);
              setEditing(true);
            }}
            disabled={saving}
            size='icon'
            variant='ghost'
            className="rounded-lg text-muted-foreground hover:text-foreground hover:bg-zinc-100 dark:hover:bg-zinc-800/60 h-8 w-8 p-0 transition-colors duration-150"
          >
            <PencilSimple className="w-4 h-4" />
          </Button>
        </>
      )}
    </div>
  );
}
