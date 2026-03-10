'use client';

import { runAsynchronously } from '@stackframe/stack-shared/dist/utils/promises';
import { Skeleton, Tabs, TabsContent, TabsList, TabsTrigger, Typography, cn } from '@stackframe/stack-ui';
import { Suspense, useEffect } from 'react';
import { useStackApp, useUser } from '..';
import { CredentialSignIn } from '../components/credential-sign-in';
import { CredentialSignUp } from '../components/credential-sign-up';
import { MaybeFullPage } from '../components/elements/maybe-full-page';
import { SeparatorWithText } from '../components/elements/separator-with-text';
import { StyledLink } from '../components/link';
import { MagicLinkSignIn } from '../components/magic-link-sign-in';
import { PredefinedMessageCard } from '../components/message-cards/predefined-message-card';
import { OAuthButtonGroup } from '../components/oauth-button-group';
import { PasskeyButton } from '../components/passkey-button';
import { useTranslation } from '../lib/translations';

type Props = {
  noPasswordRepeat?: boolean,
  firstTab?: 'magic-link' | 'password',
  fullPage?: boolean,
  type: 'sign-in' | 'sign-up',
  automaticRedirect?: boolean,
  extraInfo?: React.ReactNode,
  mockProject?: {
    config: {
      signUpEnabled: boolean,
      credentialEnabled: boolean,
      passkeyEnabled: boolean,
      magicLinkEnabled: boolean,
      oauthProviders: {
        id: string,
      }[],
    },
  },
}

export function AuthPage(props: Props) {
  return <Suspense fallback={<Fallback {...props} />}>
    <Inner {...props} />
  </Suspense>;
}

function Fallback(props: Props) {
  return (
    <MaybeFullPage fullPage={!!props.fullPage}>
      <div className='stack-scope flex flex-col items-stretch' style={{ maxWidth: '380px', flexBasis: '380px', padding: props.fullPage ? '1rem' : 0 }}>
        <div className="text-center mb-6 flex flex-col">
          <Skeleton className='h-9 w-2/3 self-center' />

          <Skeleton className='h-3 w-16 mt-8' />
          <Skeleton className='h-9 w-full mt-1' />

          <Skeleton className='h-3 w-24 mt-2' />
          <Skeleton className='h-9 w-full mt-1' />

          <Skeleton className='h-9 w-full mt-6' />
        </div>
      </div>
    </MaybeFullPage>
  );
}

function Inner(props: Props) {
  const stackApp = useStackApp();
  const user = useUser();
  const projectFromHook = stackApp.useProject();
  const project = props.mockProject || projectFromHook;
  const { t } = useTranslation();

  useEffect(() => {
    if (props.automaticRedirect && user && !props.mockProject) {
      runAsynchronously(props.type === 'sign-in'
        ? stackApp.redirectToAfterSignIn({ replace: true })
        : stackApp.redirectToAfterSignUp({ replace: true })
      );
    }
  }, [user, props.mockProject, stackApp, props.automaticRedirect]);

  if (user && !props.mockProject && !props.automaticRedirect) {
    return <PredefinedMessageCard type='signedIn' fullPage={props.fullPage} />;
  }

  if (props.type === 'sign-up' && !project.config.signUpEnabled) {
    return <PredefinedMessageCard type='signUpDisabled' fullPage={props.fullPage} />;
  }

  const hasOAuthProviders = project.config.oauthProviders.length > 0;
  const hasPasskey = (project.config.passkeyEnabled === true && props.type === "sign-in");
  const enableSeparator = (project.config.credentialEnabled || project.config.magicLinkEnabled) && (hasOAuthProviders || hasPasskey);

  return (
    <MaybeFullPage fullPage={!!props.fullPage}>
      <div className='stack-scope flex flex-col items-stretch' style={{ maxWidth: '380px', flexBasis: '380px', padding: props.fullPage ? '1rem' : 0 }}>
        <div className="text-center mb-6">
          <Typography type='h2'>
            {props.type === 'sign-in' ? t("Sign in to your account") : t("Create a new account")}
          </Typography>
          {props.type === 'sign-in' ? (
            project.config.signUpEnabled && (
              <Typography>
                {t("Don't have an account?")}{" "}
                <StyledLink href={stackApp.urls.signUp} onClick={(e) => {
                  runAsynchronously(stackApp.redirectToSignUp());
                  e.preventDefault();
                }}>{t("Sign up")}</StyledLink>
              </Typography>
            )
          ) : (
            <Typography>
              {t("Already have an account?")}{" "}
              <StyledLink href={stackApp.urls.signIn} onClick={(e) => {
                runAsynchronously(stackApp.redirectToSignIn());
                e.preventDefault();
              }}>{t("Sign in")}</StyledLink>
            </Typography>
          )}
        </div>
        {(hasOAuthProviders || hasPasskey) && (
          <div className='gap-4 flex flex-col items-stretch stack-scope'>
            {hasOAuthProviders && <OAuthButtonGroup type={props.type} mockProject={props.mockProject} />}
            {hasPasskey && <PasskeyButton type={props.type} />}
          </div>
        )}

        {enableSeparator && <SeparatorWithText text={t('Or continue with')} />}
        {project.config.credentialEnabled && project.config.magicLinkEnabled ? (
          <Tabs defaultValue={props.firstTab || 'magic-link'}>
            <TabsList className={cn('w-full mb-2', {
              'flex-row-reverse': props.firstTab === 'password'
            })}>
              <TabsTrigger value='magic-link' className='flex-1'>{t("Email")}</TabsTrigger>
              <TabsTrigger value='password' className='flex-1'>{t("Email & Password")}</TabsTrigger>
            </TabsList>
            <TabsContent value='magic-link'>
              <MagicLinkSignIn />
            </TabsContent>
            <TabsContent value='password'>
              {props.type === 'sign-up' ? <CredentialSignUp noPasswordRepeat={props.noPasswordRepeat} /> : <CredentialSignIn />}
            </TabsContent>
          </Tabs>
        ) : project.config.credentialEnabled ? (
          props.type === 'sign-up' ? <CredentialSignUp noPasswordRepeat={props.noPasswordRepeat} /> : <CredentialSignIn />
        ) : project.config.magicLinkEnabled ? (
          <MagicLinkSignIn />
        ) : !(hasOAuthProviders || hasPasskey) ? <Typography variant={"destructive"} className="text-center">{t("No authentication method enabled.")}</Typography> : null}
        {props.extraInfo && (
          <div className={cn('flex flex-col items-center text-center text-sm text-gray-500', {
            'mt-2': project.config.credentialEnabled || project.config.magicLinkEnabled,
            'mt-6': !(project.config.credentialEnabled || project.config.magicLinkEnabled),
          })}>
            <div>{props.extraInfo}</div>
          </div>
        )}
      </div>
    </MaybeFullPage>
  );
}
