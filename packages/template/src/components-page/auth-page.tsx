'use client';

import { KnownError } from '@hexclave/shared';
import { captureError } from '@hexclave/shared/dist/utils/errors';
import { runAsynchronously } from '@hexclave/shared/dist/utils/promises';
import { use } from '@hexclave/shared/dist/utils/react';
import { Tabs, TabsContent, TabsList, TabsTrigger, Typography, cn } from '@hexclave/ui';
import { Suspense, useMemo } from 'react';
import { useStackApp, useUser } from '..';
import { CredentialSignIn } from '../components/credential-sign-in';
import { CredentialSignUp } from '../components/credential-sign-up';
import { MaybeFullPage } from '../components/elements/maybe-full-page';
import { SeparatorWithText } from '../components/elements/separator-with-text';
import { StyledLink } from '../components/link';
import { KnownErrorMessageCard } from '../components/message-cards/known-error-message-card';
import { MessageCard } from '../components/message-cards/message-card';
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
    displayName?: string,
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

type AutomaticRedirectResult =
  | { status: "success" }
  | { status: "known-error", error: KnownError }
  | { status: "unknown-error" };

export function AuthPage(props: Props) {
  return <Suspense fallback={<Fallback {...props} />}>
    <Inner {...props} />
  </Suspense>;
}

function Fallback(props: Props) {
  const skeletonClassName = "animate-pulse bg-zinc-200/60 dark:bg-zinc-800/50";
  return (
    <MaybeFullPage fullPage={!!props.fullPage}>
      <div
        className='stack-scope flex flex-col items-stretch w-full mx-auto'
        style={{ maxWidth: '380px', flexBasis: '380px', padding: props.fullPage ? '1rem' : 0 }}
      >
        <div className="text-center mb-6 flex flex-col items-center">
          <div className={`h-9 w-2/3 ${skeletonClassName} rounded-lg`} />

          <div className={`h-3 w-16 mt-8 ${skeletonClassName} rounded-md`} />
          <div className={`h-9 w-full mt-1 ${skeletonClassName} rounded-xl`} />

          <div className={`h-3 w-24 mt-2 ${skeletonClassName} rounded-md`} />
          <div className={`h-9 w-full mt-1 ${skeletonClassName} rounded-xl`} />

          <div className={`h-9 w-full mt-6 ${skeletonClassName} rounded-xl`} />
        </div>
      </div>
    </MaybeFullPage>
  );
}

function AutomaticRedirect(props: {
  fullPage?: boolean,
  isRestricted: boolean,
  type: 'sign-in' | 'sign-up',
}) {
  const hexclaveApp = useStackApp();
  const { t } = useTranslation();
  const redirectResultPromise = useMemo(async (): Promise<AutomaticRedirectResult> => {
    try {
      await (
        props.isRestricted
          ? hexclaveApp.redirectToOnboarding({ replace: true })
          : props.type === 'sign-in'
            ? hexclaveApp.redirectToAfterSignIn({ replace: true })
            : hexclaveApp.redirectToAfterSignUp({ replace: true })
      );
      return { status: "success" };
    } catch (e) {
      if (KnownError.isKnownError(e)) {
        return { status: "known-error", error: e };
      }
      captureError("<AuthPage automaticRedirect />", e);
      return { status: "unknown-error" };
    }
  }, [hexclaveApp, props.isRestricted, props.type]);

  const redirectResult = use(redirectResultPromise);
  if (redirectResult.status === "known-error") {
    return <KnownErrorMessageCard error={redirectResult.error} fullPage={props.fullPage} />;
  }
  if (redirectResult.status === "unknown-error") {
    return <PredefinedMessageCard type='unknownError' fullPage={props.fullPage} />;
  }
  return <MessageCard title={t("Redirecting...")} fullPage={props.fullPage} />;
}

function Inner(props: Props) {
  const hexclaveApp = useStackApp();
  const user = useUser({ includeRestricted: true });
  const projectFromHook = hexclaveApp.useProject();
  const project = props.mockProject || projectFromHook;
  const { t } = useTranslation();

  if (props.automaticRedirect && user && !props.mockProject) {
    return <Suspense fallback={<MessageCard title={t("Redirecting...")} fullPage={props.fullPage} />}>
      <AutomaticRedirect fullPage={props.fullPage} isRestricted={user.isRestricted} type={props.type} />
    </Suspense>;
  }

  if (user && !props.mockProject && !props.automaticRedirect) {
    return <PredefinedMessageCard type='signedIn' fullPage={props.fullPage} />;
  }

  if (props.type === 'sign-up' && !project.config.signUpEnabled) {
    return <PredefinedMessageCard type='signUpDisabled' fullPage={props.fullPage} />;
  }

  const hasOAuthProviders = project.config.oauthProviders.length > 0;
  const hasPasskey = (project.config.passkeyEnabled === true && props.type === "sign-in");
  const enableSeparator = (project.config.credentialEnabled || project.config.magicLinkEnabled) && (hasOAuthProviders || hasPasskey);

  const cardContent = (
    <div
      className={cn(
        "stack-scope flex flex-col items-stretch w-full relative z-10",
        props.fullPage
          ? "max-w-[400px] text-foreground"
          : "max-w-[380px] p-0"
      )}
    >
      <div className="text-center mb-6">
        <Typography type='h2' className="text-xl font-semibold tracking-tight mb-1">
          {props.type === 'sign-in' ? t("Sign in") : t("Create account")}
        </Typography>
        <Typography className="text-sm text-muted-foreground">
          {props.type === 'sign-in' ? (
            <>
              {t("to continue to")}{" "}
              <span className="font-medium text-foreground">{project.displayName}</span>
            </>
          ) : (
            <>
              {t("to get started with")}{" "}
              <span className="font-medium text-foreground">{project.displayName}</span>
            </>
          )}
        </Typography>
      </div>

      {(hasOAuthProviders || hasPasskey) && (
        <div className='gap-2.5 flex flex-col items-stretch mb-2'>
          {hasOAuthProviders && <OAuthButtonGroup type={props.type} mockProject={props.mockProject} />}
          {hasPasskey && <PasskeyButton type={props.type} />}
        </div>
      )}

      {enableSeparator && <SeparatorWithText text={t('Or continue with')} />}

      {project.config.credentialEnabled && project.config.magicLinkEnabled ? (
        <Tabs defaultValue={props.firstTab || 'magic-link'} className="w-full">
          <TabsList className={cn('w-full mb-4 bg-muted p-1 rounded-lg h-10 border border-border', {
            'flex-row-reverse': props.firstTab === 'password'
          })}>
            <TabsTrigger value='magic-link' className='h-8 flex-1 rounded-md py-0 text-sm font-medium border border-transparent transition-all data-[state=active]:border-border data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-sm'>{t("Email")}</TabsTrigger>
            <TabsTrigger value='password' className='h-8 flex-1 rounded-md py-0 text-sm font-medium border border-transparent transition-all data-[state=active]:border-border data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-sm'>{t("Email & Password")}</TabsTrigger>
          </TabsList>
          <TabsContent value='magic-link' className="focus-visible:outline-none focus-visible:ring-0">
            <MagicLinkSignIn />
          </TabsContent>
          <TabsContent value='password' className="focus-visible:outline-none focus-visible:ring-0">
            {props.type === 'sign-up' ? <CredentialSignUp noPasswordRepeat={props.noPasswordRepeat} /> : <CredentialSignIn />}
          </TabsContent>
        </Tabs>
      ) : project.config.credentialEnabled ? (
        props.type === 'sign-up' ? <CredentialSignUp noPasswordRepeat={props.noPasswordRepeat} /> : <CredentialSignIn />
      ) : project.config.magicLinkEnabled ? (
        <MagicLinkSignIn />
      ) : !(hasOAuthProviders || hasPasskey) ? (
        <Typography variant={"destructive"} className="text-center py-4">{t("No authentication method enabled.")}</Typography>
      ) : null}

      <div className="mt-6 text-center text-sm border-t border-border pt-5">
        {props.type === 'sign-in' ? (
          project.config.signUpEnabled && (
            <p className="text-muted-foreground">
              {t("Don't have an account?")}{" "}
              <StyledLink href={hexclaveApp.urls.signUp} className="font-medium text-primary hover:underline transition-colors" onClick={(e) => {
                runAsynchronously(hexclaveApp.redirectToSignUp());
                e.preventDefault();
              }}>{t("Sign up")}</StyledLink>
            </p>
          )
        ) : (
          <p className="text-muted-foreground">
            {t("Already have an account?")}{" "}
            <StyledLink href={hexclaveApp.urls.signIn} className="font-medium text-primary hover:underline transition-colors" onClick={(e) => {
              runAsynchronously(hexclaveApp.redirectToSignIn());
              e.preventDefault();
            }}>{t("Sign in")}</StyledLink>
          </p>
        )}
      </div>

      {props.extraInfo && (
        <div className={cn('flex flex-col items-center text-center text-xs text-muted-foreground mt-4 border-t border-border pt-3', {
          'mt-2': project.config.credentialEnabled || project.config.magicLinkEnabled,
          'mt-4': !(project.config.credentialEnabled || project.config.magicLinkEnabled),
        })}>
          <div>{props.extraInfo}</div>
        </div>
      )}
    </div>
  );

  if (props.fullPage) {
    return (
      <MaybeFullPage fullPage={true}>
        <div className="relative flex items-center justify-center min-h-screen w-full overflow-hidden p-4 sm:p-6 bg-background">
          {cardContent}
        </div>
      </MaybeFullPage>
    );
  }

  return cardContent;
}
