'use client';

import { Separator, Skeleton, Typography } from '@stackframe/stack-ui';
import { icons } from 'lucide-react';
import React, { Suspense } from "react";
import { Team, useStackApp, useUser } from '..';
import { MaybeFullPage } from "../components/elements/maybe-full-page";
import { SidebarLayout } from '../components/elements/sidebar-layout';
import { TeamIcon } from '../components/team-icon';
import { useTranslation } from "../lib/translations";
import { ActiveSessionsPage } from "./account-settings/active-sessions-page";
import { ApiKeysPage } from "./account-settings/api-keys-page";
import { DeleteAccountSection } from "./account-settings/delete-account-section";
import { EmailsSection } from "./account-settings/emails-section";
import { LeaveTeamSection } from "./account-settings/leave-team-section";
import { MfaSection } from "./account-settings/mfa-section";
import { OtpSection } from "./account-settings/otp-section";
import { PasskeySection } from "./account-settings/passkey-section";
import { PasswordSection } from "./account-settings/password-section";
import { ProfilePage } from "./account-settings/profile-page";
import { SignOutSection } from "./account-settings/sign-out-section";
import { TeamApiKeysSection } from "./account-settings/team-api-keys-section";
import { TeamCreationPage } from './account-settings/team-creation-page';
import { TeamDisplayNameSection } from "./account-settings/team-display-name-section";
import { TeamMemberInvitationSection } from "./account-settings/team-member-invitation-section";
import { TeamMemberListSection } from "./account-settings/team-member-list-section";
import { TeamProfileImageSection } from "./account-settings/team-profile-image-section";
import { TeamUserProfileSection } from "./account-settings/team-profile-user-section";



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
}) {
  const { t } = useTranslation();
  const user = useUser({ or: 'redirect' });
  const teams = user.useTeams();
  const stackApp = useStackApp();
  const project = stackApp.useProject();

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
              content: <ProfilePage/>,
            },
            {
              title: t('Emails & Auth'),
              type: 'item',
              id: 'auth',
              icon: <Icon name="ShieldCheck"/>,
              content: <Suspense fallback={<EmailsAndAuthPageSkeleton/>}>
                <EmailsAndAuthPage/>
              </Suspense>,
            },
            {
              title: t('Active Sessions'),
              type: 'item',
              id: 'sessions',
              icon: <Icon name="Monitor"/>,
              content: <Suspense fallback={<ActiveSessionsPageSkeleton/>}>
                <ActiveSessionsPage/>
              </Suspense>,
            },
            ...(project.config.allowUserApiKeys ? [{
              title: t('API Keys'),
              type: 'item',
              id: 'api-keys',
              icon: <Icon name="Key" />,
              content: <Suspense fallback={<ApiKeysPageSkeleton/>}>
                <ApiKeysPage />
              </Suspense>,
            }] as const : []),
            {
              title: t('Settings'),
              type: 'item',
              id: 'settings',
              icon: <Icon name="Settings"/>,
              content: <SettingsPage/>,
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
                <TeamCreationPage />
              </Suspense>,
            }] as const : [],
          ] as const).filter((p) => p.type === 'divider' || (p as any).content )}
          title={t("Account Settings")}
        />
      </div>
    </MaybeFullPage>
  );
}

function Section(props: { title: string, description?: string, children: React.ReactNode }) {
  return (
    <>
      <Separator />
      <div className='flex flex-col sm:flex-row gap-2'>
        <div className='sm:flex-1 flex flex-col justify-center'>
          <Typography className='font-medium'>
            {props.title}
          </Typography>
          {props.description && <Typography variant='secondary' type='footnote'>
            {props.description}
          </Typography>}
        </div>
        <div className='sm:flex-1 sm:items-end flex flex-col gap-2 '>
          {props.children}
        </div>
      </div>
    </>
  );
}

function PageLayout(props: { children: React.ReactNode }) {
  return (
    <div className='flex flex-col gap-6'>
      {props.children}
    </div>
  );
}


function EmailsAndAuthPage() {
  return (
    <PageLayout>
      <EmailsSection/>
      <PasswordSection />
      <PasskeySection />
      <OtpSection />
      <MfaSection />
    </PageLayout>
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



function SettingsPage() {
  return (
    <PageLayout>
      <DeleteAccountSection />
      <SignOutSection />
    </PageLayout>
  );
}


function TeamPage(props: { team: Team }) {
  return (
    <PageLayout>
      <TeamUserProfileSection key={`user-profile-${props.team.id}`} team={props.team} />
      <TeamProfileImageSection key={`profile-image-${props.team.id}`} team={props.team} />
      <TeamDisplayNameSection key={`display-name-${props.team.id}`} team={props.team} />
      <TeamMemberListSection key={`member-list-${props.team.id}`} team={props.team} />
      <TeamMemberInvitationSection key={`member-invitation-${props.team.id}`} team={props.team} />
      <TeamApiKeysSection key={`api-keys-${props.team.id}`} team={props.team} />
      <LeaveTeamSection key={`leave-team-${props.team.id}`} team={props.team} />
    </PageLayout>
  );
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
