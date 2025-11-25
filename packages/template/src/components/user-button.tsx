'use client';

import { runAsynchronouslyWithAlert } from "@stackframe/stack-shared/dist/utils/promises";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, Skeleton, Typography } from "@stackframe/stack-ui";
import { CircleUser, LogIn, LogOut, UserPlus } from "lucide-react";
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
  mockUser?: {
    displayName?: string,
    primaryEmail?: string,
    profileImageUrl?: string,
  },
};

export function UserButton(props: UserButtonProps) {
  return (
    <Suspense fallback={<Skeleton className="h-[34px] w-[34px] rounded-full stack-scope" />}>
      <UserButtonInner {...props} />
    </Suspense>
  );
}

function UserButtonInner(props: UserButtonProps) {
  const userFromHook = useUser();

  // Use mock user if provided, otherwise use real user
  const user = props.mockUser ? {
    displayName: props.mockUser.displayName || 'Mock User',
    primaryEmail: props.mockUser.primaryEmail || 'mock@example.com',
    profileImageUrl: props.mockUser.profileImageUrl,
    signOut: () => {
      console.log('Mock sign out - no action taken in demo mode');
      return Promise.resolve();
    }
  } as CurrentUser : userFromHook;

  return <UserButtonInnerInner {...props} user={user} />;
}


function UserButtonInnerInner(props: UserButtonProps & { user: CurrentUser | null }) {
  const { t } = useTranslation();
  const user = props.user;
  const app = useStackApp();

  const iconProps = { size: 20, className: 'h-4 w-4' };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="outline-none stack-scope rounded-lg hover:bg-muted/50 transition-colors p-1 -m-1">
        <div className="flex gap-2 items-center">
          <UserAvatar user={user} />
          {user && props.showUserInfo &&
            <div className="flex flex-col justify-center text-left">
              <div className="max-w-40 truncate">{user.displayName}</div>
              <div className="max-w-40 truncate text-sm text-gray-500">{user.primaryEmail}</div>
            </div>
          }
        </div>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="stack-scope w-60" align="end">
        {user && <Item
          text={t('Account settings')}
          onClick={async () => {
            if (props.mockUser) {
              console.log('Mock account settings - no navigation in demo mode');
            } else {
              await app.redirectToAccountSettings();
            }
          }}
          icon={<CircleUser {...iconProps} />}
        />}
        {!user && <Item
          text={t('Sign in')}
          onClick={async () => {
            if (props.mockUser) {
              console.log('Mock sign in - no navigation in demo mode');
            } else {
              await app.redirectToSignIn();
            }
          }}
          icon={<LogIn {...iconProps} />}
        />}
        {!user && <Item
          text={t('Sign up')}
          onClick={async () => {
            if (props.mockUser) {
              console.log('Mock sign up - no navigation in demo mode');
            } else {
              await app.redirectToSignUp();
            }
          }}
          icon={<UserPlus {...iconProps}/> }
        />}
        {user && props.extraItems && props.extraItems.map((item, index) => (
          <Item key={index} {...item} />
        ))}
        {user && <Item
          text={t('Sign out')}
          onClick={async () => {
            if (props.mockUser) {
              console.log('Mock sign out - no action taken in demo mode');
            } else {
              await user.signOut();
            }
          }}
          icon={<LogOut {...iconProps} />}
        />}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
