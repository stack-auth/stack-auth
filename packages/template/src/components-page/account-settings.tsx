'use client';

import { Skeleton, Typography } from '@stackframe/stack-ui';
import { icons } from 'lucide-react';
import React, { Suspense } from "react";
import { useStackApp, useUser } from '..';
import { MaybeFullPage } from "../components/elements/maybe-full-page";
import { SidebarLayout } from '../components/elements/sidebar-layout';
import { TeamIcon } from '../components/team-icon';
import { useTranslation } from "../lib/translations";
import { ActiveSessionsPage } from "./account-settings/active-sessions/active-sessions-page";
import { ApiKeysPage } from "./account-settings/api-keys/api-keys-page";
import { EmailsAndAuthPage } from './account-settings/email-and-auth/email-and-auth-page';
import { ProfilePage } from "./account-settings/profile-page/profile-page";
import { SettingsPage } from './account-settings/settings/settings-page';
import { TeamCreationPage } from './account-settings/teams/team-creation-page';
import { TeamPage } from './account-settings/teams/team-page';

const Icon = ({ name }: { name: keyof typeof icons }) => {
  const LucideIcon = icons[name];
  return <LucideIcon className="mr-2 h-4 w-4"/>;
};

export function AccountSettings(props: {
  fullPage?: boolean,
  extraItems?: ({
    title: string,
    content: React.ReactNode,
    id: string,
  } & ({
    icon?: React.ReactNode,
  } | {
    iconName?: keyof typeof icons,
  }))[],
  mockUser?: {
    displayName?: string,
    profileImageUrl?: string,
  },
  mockApiKeys?: Array<{
    id: string,
    description: string,
    createdAt: string,
    expiresAt?: string,
    manuallyRevokedAt?: string,
  }>,
  mockProject?: {
    config: {
      allowUserApiKeys: boolean,
      clientTeamCreationEnabled: boolean,
    },
  },
  mockSessions?: Array<{
    id: string,
    isCurrentSession: boolean,
    isImpersonation?: boolean,
    createdAt: string,
    lastUsedAt?: string,
    geoInfo?: {
      ip?: string,
      cityName?: string,
    },
  }>,
}) {
  const { t } = useTranslation();
  const userFromHook = useUser({ or: props.mockUser ? 'return-null' : 'redirect' });
  const stackApp = useStackApp();
  const projectFromHook = stackApp.useProject();

  // Use mock data if provided, otherwise use real data
  const user = props.mockUser ? {
    useTeams: () => [], // Mock empty teams for now
  } : userFromHook;

  const project = props.mockProject || projectFromHook;
  const teams = user?.useTeams() || [];

  // If we're not in mock mode and don't have a user, the useUser hook will handle redirect
  if (!props.mockUser && !userFromHook) {
    return null;
  }

  return (
    <MaybeFullPage fullPage={!!props.fullPage}>
      <div className="self-stretch flex-grow w-full">
        <SidebarLayout
          items={([
            {
              title: t('My Profile'),
              type: 'item',
              id: 'profile',
              icon: <Icon name="Contact"/>,
              content: <ProfilePage mockUser={props.mockUser}/>,
            },
            {
              title: t('Emails & Auth'),
              type: 'item',
              id: 'auth',
              icon: <Icon name="ShieldCheck"/>,
              content: <Suspense fallback={<EmailsAndAuthPageSkeleton/>}>
                <EmailsAndAuthPage mockMode={!!props.mockUser}/>
              </Suspense>,
            },
            {
              title: t('Active Sessions'),
              type: 'item',
              id: 'sessions',
              icon: <Icon name="Monitor"/>,
              content: <Suspense fallback={<ActiveSessionsPageSkeleton/>}>
                <ActiveSessionsPage mockSessions={props.mockSessions} mockMode={!!props.mockUser}/>
              </Suspense>,
            },
            ...(project.config.allowUserApiKeys ? [{
              title: t('API Keys'),
              type: 'item',
              id: 'api-keys',
              icon: <Icon name="Key" />,
              content: <Suspense fallback={<ApiKeysPageSkeleton/>}>
                <ApiKeysPage mockApiKeys={props.mockApiKeys} mockMode={!!props.mockUser} />
              </Suspense>,
            }] as const : []),
            {
              title: t('Settings'),
              type: 'item',
              id: 'settings',
              icon: <Icon name="Settings"/>,
              content: <SettingsPage mockMode={!!props.mockUser}/>,
            },
            ...(props.extraItems?.map(item => ({
              title: item.title,
              type: 'item',
              id: item.id,
              icon: (() => {
                const iconName = (item as any).iconName as keyof typeof icons | undefined;
                if (iconName) {
                  return <Icon name={iconName}/>;
                } else if ((item as any).icon) {
                  return (item as any).icon;
                }
                return null;
              })(),
              content: item.content,
            } as const)) || []),
            ...(teams.length > 0 || project.config.clientTeamCreationEnabled) ? [{
              title: t('Teams'),
              type: 'divider',
            }] as const : [],
            ...teams.map(team => ({
              title: <div className='flex gap-2 items-center w-full'>
                <TeamIcon team={team}/>
                <Typography className="max-w-[320px] md:w-[90%] truncate">{team.displayName}</Typography>
              </div>,
              type: 'item',
              id: `team-${team.id}`,
              content: <Suspense fallback={<TeamPageSkeleton/>}>
                <TeamPage team={team}/>
              </Suspense>,
            } as const)),
            ...project.config.clientTeamCreationEnabled ? [{
              title: t('Create a team'),
              icon: <Icon name="CirclePlus"/>,
              type: 'item',
              id: 'team-creation',
              content: <Suspense fallback={<TeamCreationSkeleton/>}>
                <TeamCreationPage mockMode={!!props.mockUser} />
              </Suspense>,
            }] as const : [],
          ] as const).filter((p) => p.type === 'divider' || (p as any).content )}
          title={t("Account Settings")}
        />
      </div>
    </MaybeFullPage>
  );
}

function PageLayout(props: { children: React.ReactNode }) {
  return (
    <div className='flex flex-col gap-6'>
      {props.children}
    </div>
  );
}

function EmailsAndAuthPageSkeleton() {
  return <PageLayout>
    <Skeleton className="h-9 w-full mt-1"/>
    <Skeleton className="h-9 w-full mt-1"/>
    <Skeleton className="h-9 w-full mt-1"/>
    <Skeleton className="h-9 w-full mt-1"/>
  </PageLayout>;
}

function ActiveSessionsPageSkeleton() {
  return <PageLayout>
    <Skeleton className="h-6 w-48 mb-2"/>
    <Skeleton className="h-4 w-full mb-4"/>
    <Skeleton className="h-[200px] w-full mt-1 rounded-md"/>
  </PageLayout>;
}

function ApiKeysPageSkeleton() {
  return <PageLayout>
    <Skeleton className="h-9 w-full mt-1"/>
    <Skeleton className="h-[200px] w-full mt-1 rounded-md"/>
  </PageLayout>;
}

function TeamPageSkeleton() {
  return <PageLayout>
    <Skeleton className="h-9 w-full mt-1"/>
    <Skeleton className="h-9 w-full mt-1"/>
    <Skeleton className="h-9 w-full mt-1"/>
    <Skeleton className="h-[200px] w-full mt-1 rounded-md"/>
  </PageLayout>;
}

function TeamCreationSkeleton() {
  return <PageLayout>
    <Skeleton className="h-9 w-full mt-1"/>
    <Skeleton className="h-9 w-full mt-1"/>
  </PageLayout>;
}
