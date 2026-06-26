"use client";

import React, { useState } from "react";
import { Input } from "./input";
import { Label } from "./label";
import { SimpleTooltip } from "./simple-tooltip";
import { Textarea } from "./textarea";
import { CopyButton } from "./copy-button";
import { EyeIcon, EyeSlashIcon } from "@phosphor-icons/react";

export function CopyField(props: {
  value: string,
  label?: React.ReactNode,
  helper?: React.ReactNode,
  monospace?: boolean,
  fixedSize?: boolean,
  initialCopied?: boolean,
  isSecret?: boolean,
} & ({
  type: "textarea",
  height?: number,
} | {
  type: "input",
})) {
  const [isRevealed, setIsRevealed] = useState(false);

  return (
    <div>
      {props.label && (
        <Label className="flex items-center gap-2 mb-2">
          {props.label}
          {props.helper && <SimpleTooltip type="info" tooltip={props.helper} />}
        </Label>
      )}
      {props.type === "textarea" ? (
        <div className="relative pr-2">
          <Textarea
            readOnly
            value={props.value}
            style={{
              height: props.height,
              fontFamily: props.monospace ? "ui-monospace, monospace" : "inherit",
              whiteSpace: props.monospace ? "pre" : "normal",
              resize: props.fixedSize ? "none" : "vertical"
            }}
          />
          <CopyButton content={props.value} initialCopied={props.initialCopied} className="absolute right-4 top-2" />
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <Input
            readOnly
            type={props.isSecret && !isRevealed ? "password" : "text"}
            value={props.value}
            className={props.isSecret ? "font-mono pr-10" : undefined}
            style={{
              fontFamily: props.monospace ? "ui-monospace, monospace" : "inherit",
            }}
          />
          {props.isSecret && (
            <button
              type="button"
              onClick={() => setIsRevealed(!isRevealed)}
              className="h-9 w-9 flex items-center justify-center rounded-xl border border-black/[0.08] dark:border-white/[0.06] bg-white/80 dark:bg-foreground/[0.03] shadow-sm text-muted-foreground/60 hover:text-foreground hover:bg-white dark:hover:bg-foreground/[0.06] transition-all shrink-0"
              title={isRevealed ? "Hide key" : "Show key"}
            >
              {isRevealed ? <EyeSlashIcon className="h-4 w-4" /> : <EyeIcon className="h-4 w-4" />}
            </button>
          )}
          <CopyButton content={props.value} initialCopied={props.initialCopied} className="h-9 w-9 p-1.5 rounded-xl border border-black/[0.08] dark:border-white/[0.06] bg-white/80 dark:bg-foreground/[0.03] shadow-sm hover:bg-white dark:hover:bg-foreground/[0.06] transition-all shrink-0" />
        </div>
      )}
    </div>
  );
}

