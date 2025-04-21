
//===========================================
// THIS FILE IS AUTO-GENERATED FROM TEMPLATE. DO NOT EDIT IT DIRECTLY
//===========================================
import { Avatar, AvatarImage, Typography } from "@stackframe/stack-ui";
import { Team } from "..";

export function TeamIcon(props: { team: Team }) {
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
