
//===========================================
// THIS FILE IS AUTO-GENERATED FROM TEMPLATE. DO NOT EDIT IT DIRECTLY
//===========================================
import { Avatar, AvatarFallback, AvatarImage } from "@stackframe/stack-ui";
import { UserRound } from "lucide-react";

const defaultSize = 34;

export function UserAvatar(props: {
  size?: number,
  user?: {
    profileImageUrl?: string | null,
    displayName?: string | null,
    primaryEmail?: string | null,
  } | null,
  border?: boolean,
}) {
  const user = props.user;
  return (
    <Avatar style={{ height: props.size || defaultSize, width: props.size || defaultSize }} className={props.border ? 'border' : ''}>
      <AvatarImage src={user?.profileImageUrl || ''} />
      <AvatarFallback>
        {user ?
          <div className='font-medium' style={{ fontSize: (props.size || defaultSize) * 0.4 }}>
            {(user.displayName || user.primaryEmail)?.slice(0, 2).toUpperCase()}
          </div> :
          <UserRound className="text-zinc-500" size={(props.size || defaultSize) * 0.6} />}
      </AvatarFallback>
    </Avatar>
  );
}
