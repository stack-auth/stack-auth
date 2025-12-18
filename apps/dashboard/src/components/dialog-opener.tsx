import React, { useState, ReactNode } from 'react';
import { Button } from "@/components/ui";

type DialogState = {
  isOpen: boolean,
  setIsOpen: (open: boolean) => void,
}

type DialogOpenerProps = {
  triggerLabel?: string,
  children: (state: DialogState) => ReactNode,
}

export function DialogOpener({ triggerLabel, children }: DialogOpenerProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      {triggerLabel && (
        <Button onClick={() => setIsOpen(true)}>
          {triggerLabel}
        </Button>
      )}
      {children({ isOpen, setIsOpen })}
    </>
  );
};
