'use client';

import { BrandIcons, Button, SimpleTooltip } from '@stackframe/stack-ui';
import Color from 'color';
import { useEffect, useId, useState } from 'react';
import { useStackApp } from '..';
import { useTranslation } from '../lib/translations';
import { useInIframe } from './use-in-iframe';

const iconSize = 22;

const changeColor = (c: Color, value: number) => {
  if (c.isLight()) {
    value = -value;
  }
  return c.hsl(c.hue(), c.saturationl(), c.lightness() + value).toString();
};

export function OAuthButton({
  provider,
  type,
  isMock = false,
}: {
  provider: string,
  type: 'sign-in' | 'sign-up',
  isMock?: boolean,
}) {
  const { t } = useTranslation();
  const stackApp = useStackApp();
  const styleId = useId().replaceAll(':', '-');
  const isIframe = useInIframe();

  const [lastUsed, setLastUsed] = useState<string | null>(null);
  useEffect(() => {
    setLastUsed(localStorage.getItem('_STACK_AUTH.lastUsed'));
  }, []);

  let style : {
    backgroundColor?: string,
    textColor?: string,
    name: string,
    icon: JSX.Element | null,
    border?: string,
  };
  switch (provider) {
    case 'google': {
      style = {
        backgroundColor: '#fff',
        textColor: '#000',
        name: 'Google',
        border: '1px solid #ddd',
        icon: <BrandIcons.Google iconSize={iconSize} />,
      };
      break;
    }
    case 'github': {
      style = {
        backgroundColor: '#111',
        textColor: '#fff',
        border: '1px solid #333',
        name: 'GitHub',
        icon: <BrandIcons.GitHub iconSize={iconSize} />,
      };
      break;
    }
    case 'facebook': {
      style = {
        backgroundColor: '#1877F2',
        textColor: '#fff',
        name: 'Facebook',
        icon: <BrandIcons.Facebook iconSize={iconSize} />,
      };
      break;
    }
    case 'microsoft': {
      style = {
        backgroundColor: '#2f2f2f',
        textColor: '#fff',
        name: 'Microsoft',
        icon: <BrandIcons.Microsoft iconSize={iconSize} />,
      };
      break;
    }
    case 'spotify': {
      style = {
        backgroundColor: '#1DB954',
        textColor: '#fff',
        name: 'Spotify',
        icon: <BrandIcons.Spotify iconSize={iconSize} />,
      };
      break;
    }
    case 'discord': {
      style = {
        backgroundColor: '#5865F2',
        textColor: '#fff',
        name: 'Discord',
        icon: <BrandIcons.Discord iconSize={iconSize} />,
      };
      break;
    }
    case 'gitlab': {
      style = {
        backgroundColor: "#111",
        textColor: "#fff",
        border: "1px solid #333",
        name: "Gitlab",
        icon: <BrandIcons.Gitlab iconSize={iconSize} />,
      };
      break;
    }
    case 'apple': {
      style = {
        backgroundColor: "#000",
        textColor: "#fff",
        border: "1px solid #333",
        name: "Apple",
        icon: <BrandIcons.Apple iconSize={iconSize} />,
      };
      break;
    }
    case "bitbucket": {
      style = {
        backgroundColor: "#fff",
        textColor: "#000",
        border: "1px solid #ddd",
        name: "Bitbucket",
        icon: <BrandIcons.Bitbucket iconSize={iconSize} />,
      };
      break;
    }
    case 'linkedin': {
      style = {
        backgroundColor: "#0073b1",
        textColor: "#fff",
        name: "LinkedIn",
        icon: <BrandIcons.LinkedIn iconSize={iconSize} />,
      };
      break;
    }
    case 'x': {
      style = {
        backgroundColor: "#000",
        textColor: "#fff",
        name: "X",
        icon: <BrandIcons.X iconSize={iconSize} />,
      };
      break;
    }
    case 'twitch': {
      style = {
        backgroundColor: "#6441a5",
        textColor: "#fff",
        name: "Twitch",
        icon: <BrandIcons.Twitch iconSize={iconSize} />,
      };
      break;
    }
    case 'okta': {
      style = {
        backgroundColor: "#007dc1",
        textColor: "#fff",
        name: "Okta",
        icon: <BrandIcons.Okta iconSize={iconSize} />,
      };
      break;
    }
    default: {
      style = {
        name: provider,
        icon: null,
      };
    }
  }

  const styleSheet = `
    .stack-oauth-button-${styleId} {
      background-color: ${style.backgroundColor} !important;
      color: ${style.textColor} !important;
      border: ${style.border} !important;
    }
    .stack-oauth-button-${styleId}:hover {
      background-color: ${changeColor(Color(style.backgroundColor), 10)} !important;
    }
  `;

  return (
    <>
      <style>{styleSheet}</style>
      <SimpleTooltip
        disabled={!isIframe}
        tooltip={isIframe ? "This auth provider is not supported in an iframe for security reasons." : undefined}
        className='stack-scope w-full inline-flex'
      >
        <Button
          onClick={async () => {
            localStorage.setItem('_STACK_AUTH.lastUsed', provider);
            await stackApp.signInWithOAuth(provider);
          }}
          className={`stack-oauth-button-${styleId} stack-scope relative w-full`}
          disabled={isIframe}
        >
          {!isMock && lastUsed === provider && (
            <span className="absolute -top-2 -right-2 bg-blue-500 text-white text-xs px-2 py-1 rounded-md">
            last
            </span>
          )}
          <div className='flex items-center w-full gap-4'>
            {style.icon}
            <span className='flex-1'>
              {type === 'sign-up' ?
              t('Sign up with {provider}', { provider: style.name }) :
              t('Sign in with {provider}', { provider: style.name })
              }
            </span>
          </div>
        </Button>
      </SimpleTooltip>
    </>
  );
}
