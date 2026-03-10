'use client';

import { useStackApp } from "../lib/hooks";
import { getTurnstileSiteKey, useTurnstile } from "../lib/turnstile";
import { OAuthButton } from "./oauth-button";

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
  const stackApp = useStackApp();
  const { executeTurnstile, turnstileWidget } = useTurnstile({
    siteKey: getTurnstileSiteKey(stackApp),
    action: "oauth_authenticate",
  });
  const project = mockProject || stackApp.useProject();
  return (
    <div className='gap-4 flex flex-col items-stretch stack-scope'>
      {project.config.oauthProviders.map(p => (
        <OAuthButton key={p.id} provider={p.id} type={type}
          isMock={!!mockProject}
          getTurnstileToken={!mockProject ? executeTurnstile : undefined}
        />
      ))}
      {!mockProject ? turnstileWidget : null}
    </div>
  );
}
