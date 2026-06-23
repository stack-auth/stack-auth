import { Avatar, AvatarImage, AvatarFallback } from "~/components/ui";

import { User } from "@phosphor-icons/react";
import { Team } from "@hexclave/react";

const teamIconClassName = "flex shrink-0 items-center justify-center size-6 rounded-md bg-muted border border-black/[0.08] dark:border-white/[0.08]";

export function TeamIcon(props: { team: Team | 'personal' }) {
  if (props.team === 'personal') {
    return (
      <div className={`${teamIconClassName} text-foreground/70`}>
        <User className="size-3.5" />
      </div>
    );
  }
  if (props.team.profileImageUrl) {
    return (
      <Avatar className={`${teamIconClassName} overflow-hidden p-0`}>
        <AvatarImage src={props.team.profileImageUrl} alt={props.team.displayName} className="size-full" />
        <AvatarFallback className="size-full rounded-md bg-muted text-[10px] font-bold text-foreground">
          {props.team.displayName.slice(0, 1).toUpperCase()}
        </AvatarFallback>
      </Avatar>
    );
  } else {
    return (
      <div className={`${teamIconClassName} text-foreground`}>
        <span className="text-[10px] font-bold leading-none">{props.team.displayName.slice(0, 1).toUpperCase()}</span>
      </div>
    );
  }
}
