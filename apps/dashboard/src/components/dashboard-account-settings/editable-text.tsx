'use client';

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PencilSimple } from "@phosphor-icons/react";
import { useState } from "react";

export function EditableText(props: { value: string, onSave?: (value: string) => void | Promise<void> }) {
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
            className="bg-white dark:bg-zinc-900 border-black/[0.08] dark:border-white/[0.08] rounded-xl px-3 py-2 shadow-sm focus-visible:ring-black/[0.06] dark:focus-visible:ring-white/[0.06] min-w-[200px]"
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
            className="bg-black text-white hover:bg-zinc-800 dark:bg-white dark:text-black dark:hover:bg-zinc-200 rounded-xl px-4 transition-colors duration-150"
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
            className="border-black/[0.08] dark:border-white/[0.08] hover:bg-zinc-50 dark:hover:bg-zinc-900 rounded-xl px-4 transition-colors duration-150"
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
            className="rounded-lg text-muted-foreground hover:text-foreground hover:bg-zinc-100 dark:hover:bg-zinc-900 h-8 w-8 p-0 transition-colors duration-150"
          >
            <PencilSimple className="w-4 h-4" />
          </Button>
        </>
      )}
    </div>
  );
}
