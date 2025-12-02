import React from "react";

export type CmdKCommand = {
  icon: React.ReactNode,
  label: string,
  description: string,
  onSelect: {
    type: "preview",
  } | {
    type: "action",
    action: () => void | Promise<void>,
  } | {
    type: "navigate",
    href: string,
  },
  preview: null | React.ComponentType<{
    isSelected: boolean,
    registerOnFocus: (onFocus: () => void) => void,
    unregisterOnFocus: (onFocus: () => void) => void,
  }>,
};

export function useCmdKCommands(commands: CmdKCommand[]) {
  // TODO: Implement this
}
