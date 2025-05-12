'use client';

import { runAsynchronouslyWithAlert } from "@stackframe/stack-shared/dist/utils/promises";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger, Skeleton, Typography } from "@stackframe/stack-ui";
import { CircleUser, LogIn, LogOut, SunMoon, UserPlus } from "lucide-react";
import React, { Suspense } from "react";
import { CurrentUser, useStackApp, useUser } from "..";
import { useTranslation } from "../lib/translations";
import { UserAvatar } from "./elements/user-avatar";

function Item(props: { text: string, icon: React.ReactNode, onClick: () => void | Promise<void> }) {
  return (
    <DropdownMenuItem onClick={() => runAsynchronouslyWithAlert(props.onClick)}>
      <div className="flex gap-2 items-center">
        {props.icon}
        <Typography>{props.text}</Typography>
      </div>
    </DropdownMenuItem>
  );
}

type UserButtonProps = {
  showUserInfo?: boolean,
  colorModeToggle?: () => void | Promise<void>,
  extraItems?: {
    text: string,
    icon: React.ReactNode,
    onClick: () => void | Promise<void>,
  }[],
};

export function UserButton(props: UserButtonProps) {
  return (
    <Suspense fallback={<Skeleton className="h-[34px] w-[34px] rounded-full stack-scope" />}>
      <UserButtonInner {...props} />
    </Suspense>
  );
}

function UserButtonInner(props: UserButtonProps) {
  const user = useUser();
  return <UserButtonInnerInner {...props} user={user} />;
}


function UserButtonInnerInner(props: UserButtonProps & { user: CurrentUser | null }) {
  const { t } = useTranslation();
  const user = props.user;
  const app = useStackApp();

  const iconProps = { size: 20, className: 'h-4 w-4' };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="outline-none stack-scope">
        <div className="flex gap-2 items-center">
          <UserAvatar user={user} />
          {user && props.showUserInfo &&
            <div className="flex flex-col justify-center text-left">
              <Typography className="max-w-40 truncate">{user.displayName}</Typography>
              <Typography className="max-w-40 truncate" variant="secondary" type='label'>{user.primaryEmail}</Typography>
            </div>
          }
        </div>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="stack-scope">
        <DropdownMenuLabel>
          <div className="flex gap-2 items-center">
            <UserAvatar user={user} />
            <div>
              {user && <Typography className="max-w-40 truncate">{user.displayName}</Typography>}
              {user && <Typography className="max-w-40 truncate" variant="secondary" type='label'>{user.primaryEmail}</Typography>}
              {!user && <Typography>{t('Not signed in')}</Typography>}
            </div>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {user && <Item
          text={t('Account settings')}
          onClick={async () => await app.redirectToAccountSettings()}
          icon={<CircleUser {...iconProps} />}
        />}
        {!user && <Item
          text={t('Sign in')}
          onClick={async () => await app.redirectToSignIn()}
          icon={<LogIn {...iconProps} />}
        />}
        {!user && <Item
          text={t('Sign up')}
          onClick={async () => await app.redirectToSignUp()}
          icon={<UserPlus {...iconProps}/> }
        />}
        {user && props.extraItems && props.extraItems.map((item, index) => (
          <Item key={index} {...item} />
        ))}
        {props.colorModeToggle && (
          <Item
            text={t('Toggle theme')}
            onClick={props.colorModeToggle}
            icon={<SunMoon {...iconProps} />}
          />
        )}
        {user && <Item
          text={t('Sign out')}
          onClick={() => user.signOut()}
          icon={<LogOut {...iconProps} />}
        />}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
