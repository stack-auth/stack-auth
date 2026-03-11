'use client';

import { useStackApp } from "../lib/hooks";
import { useStagedTurnstile } from "../lib/turnstile";
import { useTranslation } from "../lib/translations";
import { OAuthButton } from "./oauth-button";
import { FormWarningText } from "./elements/form-warning";
export function OAuthButtonGroup({
  type,
  mockProject,
}: {
  type: 'sign-in' | 'sign-up',
  mockProject?: {
    config: {
      oauthProviders: {
        id: string,
      }[],
    },
  },
}) {
  const { t } = useTranslation();
  const stackApp = useStackApp();
  const {
    challengeRequiredResult,
    visibleTurnstileToken,
    challengeError,
    invisibleTurnstileWidget,
    visibleTurnstileWidget,
    clearChallengeError,
    getTurnstileFlowOptions,
    handleChallengeRequired,
  } = useStagedTurnstile(stackApp, {
    action: "oauth_authenticate",
    missingVisibleChallengeMessage: t('Please solve the captcha before continuing'),
    challengeRequiredMessage: t('Complete the captcha to continue'),
  });
  const project = mockProject || stackApp.useProject();
  return (
    <div className='gap-4 flex flex-col items-stretch stack-scope'>
      {project.config.oauthProviders.map(p => (
        <OAuthButton key={p.id} provider={p.id} type={type}
          isMock={!!mockProject}
          disabled={!mockProject && challengeRequiredResult != null && visibleTurnstileToken == null}
          getTurnstileFlowOptions={!mockProject ? getTurnstileFlowOptions : undefined}
          onTurnstileChallengeRequired={!mockProject ? handleChallengeRequired : undefined}
          clearTurnstileError={!mockProject ? clearChallengeError : undefined}
        />
      ))}
      {!mockProject ? <FormWarningText text={challengeError ?? undefined} /> : null}
      {!mockProject ? visibleTurnstileWidget : null}
      {!mockProject ? invisibleTurnstileWidget : null}
    </div>
  );
}
