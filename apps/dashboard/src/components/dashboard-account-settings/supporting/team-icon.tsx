'use client';

import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { User } from "@phosphor-icons/react";
import { Team } from "@hexclave/next";

export function TeamIcon(props: { team: Team | 'personal' }) {
  if (props.team === 'personal') {
    return (
      <div className="flex items-center justify-center h-6 w-6 rounded-md bg-zinc-100 dark:bg-zinc-800 border border-black/[0.08] dark:border-white/[0.08] text-foreground/70 shadow-sm">
        <User className="w-3.5 h-3.5" />
      </div>
    );
  }
  if (props.team.profileImageUrl) {
    return (
      <Avatar className="h-6 w-6 rounded-md border border-black/[0.08] dark:border-white/[0.08] shadow-sm">
        <AvatarImage src={props.team.profileImageUrl} alt={props.team.displayName} />
        <AvatarFallback className="bg-zinc-100 dark:bg-zinc-800 text-[10px] font-bold text-foreground">
          {props.team.displayName.slice(0, 1).toUpperCase()}
        </AvatarFallback>
      </Avatar>
    );
  } else {
    return (
      <div className="flex items-center justify-center h-6 w-6 rounded-md bg-zinc-100 dark:bg-zinc-800 border border-black/[0.08] dark:border-white/[0.08] text-foreground shadow-sm">
        <span className="text-[10px] font-bold">{props.team.displayName.slice(0, 1).toUpperCase()}</span>
      </div>
    );
  }
}
