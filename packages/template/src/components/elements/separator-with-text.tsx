'use client';

import { Separator } from "@hexclave/ui";

export function SeparatorWithText({ text }: { text: string }) {
  return (
    <div className="flex items-center justify-center my-6 stack-scope">
      <div className="flex-1">
        <Separator />
      </div>
      <div className="mx-2 text-sm text-zinc-500">{text}</div>
      <div className="flex-1">
        <Separator />
      </div>
    </div>
  );
}
