import { Avatar, AvatarImage, Typography } from "@stackframe/stack-ui";
import { User2 } from "lucide-react";
import { Team } from "..";

export function TeamIcon(props: { team: Team | 'personal' }) {
  if (props.team === 'personal') {
    return (
      <div className="flex items-center justify-center min-w-6 min-h-6 max-w-6 max-h-6 rounded bg-zinc-200">
        <User2 className="w-4 h-4" />
      </div>
    );
  }
  if (props.team.profileImageUrl) {
    return (
      <Avatar className="min-w-6 min-h-6 max-w-6 max-h-6 rounded">
        <AvatarImage src={props.team.profileImageUrl} alt={props.team.displayName} />
      </Avatar>
    );
  } else {
    return (
      <div className="flex items-center justify-center min-w-6 min-h-6 max-w-6 max-h-6 rounded bg-zinc-200">
        <Typography className="text-zinc-800 dark:text-zinc-800">{props.team.displayName.slice(0, 1).toUpperCase()}</Typography>
      </div>
    );
  }
}
