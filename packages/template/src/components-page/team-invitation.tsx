'use client';

import { KnownErrors } from "@stackframe/stack-shared";
import { cacheFunction } from "@stackframe/stack-shared/dist/utils/caches";
import { runAsynchronouslyWithAlert } from "@stackframe/stack-shared/dist/utils/promises";
import { Typography } from "@stackframe/stack-ui";
import React from "react";
import { MessageCard, StackClientApp, useStackApp, useUser } from "..";
import { PredefinedMessageCard } from "../components/message-cards/predefined-message-card";
import { useTranslation } from "../lib/translations";

const cachedVerifyInvitation = cacheFunction(async (stackApp: StackClientApp<true>, code: string) => {
  return await stackApp.verifyTeamInvitationCode(code);
});

const cachedGetInvitationDetails = cacheFunction(async (stackApp: StackClientApp<true>, code: string) => {
  return await stackApp.getTeamInvitationDetails(code);
});

function TeamInvitationInner(props: { fullPage?: boolean, searchParams: Record<string, string> }) {
  const { t } = useTranslation();
  const stackApp = useStackApp();
  const [success, setSuccess] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const details = React.use(cachedGetInvitationDetails(stackApp, props.searchParams.code || ''));

  if (errorMessage || details.status === 'error') {
    return (
      <PredefinedMessageCard type="unknownError" fullPage={props.fullPage} />
    );
  }

  if (success) {
    return (
      <MessageCard
        title={t('Team invitation')}
        fullPage={props.fullPage}
        primaryButtonText="Go home"
        primaryAction={() => stackApp.redirectToHome()}
      >
        <Typography>You have successfully joined {details.data.teamDisplayName}</Typography>
      </MessageCard>
    );
  }


  return (
    <MessageCard
      title={t('Team invitation')}
      fullPage={props.fullPage}
      primaryButtonText={t('Join')}
      primaryAction={() => runAsynchronouslyWithAlert(async () => {
        const result = await stackApp.acceptTeamInvitation(props.searchParams.code || '');
        if (result.status === 'error') {
        setErrorMessage(result.error.message);
        } else {
        setSuccess(true);
        }
      })}
      secondaryButtonText={t('Ignore')}
      secondaryAction={() => stackApp.redirectToHome()}
    >
      <Typography>You are invited to join {details.data.teamDisplayName}</Typography>
    </MessageCard>
  );
}

export function TeamInvitation({ fullPage=false, searchParams }: { fullPage?: boolean, searchParams: Record<string, string> }) {
  const { t } = useTranslation();
  const user = useUser();
  const stackApp = useStackApp();

  const invalidJsx = (
    <MessageCard title={t('Invalid Team Invitation Link')} fullPage={fullPage}>
      <Typography>{t('Please double check if you have the correct team invitation link.')}</Typography>
    </MessageCard>
  );

  const expiredJsx = (
    <MessageCard title={t('Expired Team Invitation Link')} fullPage={fullPage}>
      <Typography>{t('Your team invitation link has expired. Please request a new team invitation link ')}</Typography>
    </MessageCard>
  );

  const usedJsx = (
    <MessageCard title={t('Used Team Invitation Link')} fullPage={fullPage}>
      <Typography>{t('This team invitation link has already been used.')}</Typography>
    </MessageCard>
  );

  const code = searchParams.code;
  if (!code) {
    return invalidJsx;
  }

  if (!user) {
    return (
      <MessageCard
        title={t('Team invitation')}
        fullPage={fullPage}
        primaryButtonText={t('Sign in')}
        primaryAction={() => stackApp.redirectToSignIn()}
        secondaryButtonText={t('Cancel')}
        secondaryAction={() => stackApp.redirectToHome()}
      >
        <Typography>{t('Sign in or create an account to join the team.')}</Typography>
      </MessageCard>
    );
  }

  const verificationResult = React.use(cachedVerifyInvitation(stackApp, searchParams.code || ''));

  if (verificationResult.status === 'error') {
    const error = verificationResult.error;
    if (KnownErrors.VerificationCodeNotFound.isInstance(error)) {
      return invalidJsx;
    } else if (KnownErrors.VerificationCodeExpired.isInstance(error)) {
      return expiredJsx;
    } else if (KnownErrors.VerificationCodeAlreadyUsed.isInstance(error)) {
      return usedJsx;
    } else {
      throw error;
    }
  }

  return <TeamInvitationInner fullPage={fullPage} searchParams={searchParams} />;
};
