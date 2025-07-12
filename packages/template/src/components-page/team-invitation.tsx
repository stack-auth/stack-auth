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

function TeamInvitationInner(props: { 
  fullPage?: boolean, 
  searchParams: Record<string, string>,
  entityName?: string,
}) {
  const { t } = useTranslation();
  const stackApp = useStackApp();
  const [success, setSuccess] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const details = React.use(cachedGetInvitationDetails(stackApp, props.searchParams.code || ''));
  const entityName = props.entityName ?? "Team"

  if (errorMessage || details.status === 'error') {
    return (
      <PredefinedMessageCard type="unknownError" fullPage={props.fullPage} />
    );
  }

  if (success) {
    return (
      <MessageCard
        title={t('{entity} invitation', {entity: entityName})}
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
      title={t('{entity} invitation', {entity: entityName})}
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

export function TeamInvitation(props: { 
  fullPage?: boolean, 
  searchParams: Record<string, string> 
  entityName?: string,
}) {
  const { t } = useTranslation();
  const user = useUser();
  const stackApp = useStackApp();
  const fullPage = props.fullPage ?? false;
  const searchParams = props.searchParams;
  const entityName = props.entityName ?? "Team";

  const invalidJsx = (
    <MessageCard title={t('Invalid {entity} Invitation Link', {entity: entityName})} fullPage={fullPage}>
      <Typography>{t('Please double check if you have the correct {entity} invitation link.', {entity: entityName.toLowerCase()})}</Typography>
    </MessageCard>
  );

  const expiredJsx = (
    <MessageCard title={t('Expired {entity} Invitation Link', {entity: entityName})} fullPage={fullPage}>
      <Typography>{t('Your {entity} invitation link has expired. Please request a new {entity} invitation link ', {entity: entityName.toLowerCase()})}</Typography>
    </MessageCard>
  );

  const usedJsx = (
    <MessageCard title={t('Used {entity} Invitation Link', {entity: entityName})} fullPage={fullPage}>
      <Typography>{t('This {entity} invitation link has already been used.', {entity: entityName.toLowerCase()})}</Typography>
    </MessageCard>
  );

  const code = searchParams.code;
  if (!code) {
    return invalidJsx;
  }

  if (!user) {
    return (
      <MessageCard
        title={t('{entity} invitation', {entity: entityName})}
        fullPage={fullPage}
        primaryButtonText={t('Sign in')}
        primaryAction={() => stackApp.redirectToSignIn()}
        secondaryButtonText={t('Cancel')}
        secondaryAction={() => stackApp.redirectToHome()}
      >
        <Typography>{t('Sign in or create an account to join the {entity}.', {entity: entityName.toLowerCase()})}</Typography>
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

  return <TeamInvitationInner fullPage={fullPage} searchParams={searchParams} entityName={entityName}/>;
};
