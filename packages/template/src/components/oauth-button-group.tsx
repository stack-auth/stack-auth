'use client';

import { useStackApp } from "../lib/hooks";
import { useTurnstileAuth } from "../lib/turnstile-auth";
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
  const turnstile = useTurnstileAuth({
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
          disabled={!mockProject && !turnstile.canSubmit}
          onAuthenticate={!mockProject ? async () => {
            await turnstile.run(async (turnstileFlowOptions) => {
              await stackApp.signInWithOAuth(p.id, turnstileFlowOptions);
            });
          } : undefined}
          clearTurnstileError={!mockProject ? turnstile.clearChallengeError : undefined}
        />
      ))}
      {!mockProject ? <FormWarningText text={turnstile.challengeError ?? undefined} /> : null}
      {!mockProject ? turnstile.visibleTurnstileWidget : null}
      {!mockProject ? turnstile.invisibleTurnstileWidget : null}
    </div>
  );
}
