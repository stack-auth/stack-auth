'use client';

import { Badge, BrandIcons, Button, SimpleTooltip } from '@hexclave/ui';
import type { ReactElement } from 'react';
import { useEffect, useState } from 'react';
import { useStackApp } from '../lib/hooks';
import { useTranslation } from '../lib/translations';
import { useInIframe } from './use-in-iframe';

const iconSize = 20;

export function OAuthButton({
  provider,
  type,
  isMock = false,
  onAuthenticate,
}: {
  provider: string,
  type: 'sign-in' | 'sign-up',
  isMock?: boolean,
  onAuthenticate?: () => Promise<void>,
}) {
  const { t } = useTranslation();
  const hexclaveApp = useStackApp();
  const isIframe = useInIframe();

  const [lastUsed, setLastUsed] = useState<string | null>(null);
  useEffect(() => {
    setLastUsed(localStorage.getItem('_HEXCLAVE.lastUsed'));
  }, []);

  let style : {
    name: string,
    icon: ReactElement | null,
    iconClassName?: string,
  };
  switch (provider) {
    case 'google': {
      style = {
        name: 'Google',
        icon: <BrandIcons.Google iconSize={iconSize} />,
      };
      break;
    }
    case 'github': {
      style = {
        name: 'GitHub',
        icon: <BrandIcons.GitHub iconSize={iconSize} />,
        iconClassName: "invert dark:invert-0",
      };
      break;
    }
    case 'facebook': {
      style = {
        name: 'Facebook',
        icon: <BrandIcons.Facebook iconSize={iconSize} />,
        iconClassName: "invert dark:invert-0",
      };
      break;
    }
    case 'microsoft': {
      style = {
        name: 'Microsoft',
        icon: <BrandIcons.Microsoft iconSize={iconSize} />,
      };
      break;
    }
    case 'spotify': {
      style = {
        name: 'Spotify',
        icon: <BrandIcons.Spotify iconSize={iconSize} />,
        iconClassName: "invert dark:invert-0",
      };
      break;
    }
    case 'discord': {
      style = {
        name: 'Discord',
        icon: <BrandIcons.Discord iconSize={iconSize} />,
        iconClassName: "invert dark:invert-0",
      };
      break;
    }
    case 'gitlab': {
      style = {
        name: "Gitlab",
        icon: <BrandIcons.Gitlab iconSize={iconSize} />,
      };
      break;
    }
    case 'apple': {
      style = {
        name: "Apple",
        icon: <BrandIcons.Apple iconSize={iconSize} />,
        iconClassName: "invert dark:invert-0",
      };
      break;
    }
    case "bitbucket": {
      style = {
        name: "Bitbucket",
        icon: <BrandIcons.Bitbucket iconSize={iconSize} />,
      };
      break;
    }
    case 'linkedin': {
      style = {
        name: "LinkedIn",
        icon: <BrandIcons.LinkedIn iconSize={iconSize} />,
        iconClassName: "invert dark:invert-0",
      };
      break;
    }
    case 'x': {
      style = {
        name: "X",
        icon: <BrandIcons.X iconSize={iconSize} />,
        iconClassName: "invert dark:invert-0",
      };
      break;
    }
    case 'twitch': {
      style = {
        name: "Twitch",
        icon: <BrandIcons.Twitch iconSize={iconSize} />,
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

  let buttonClasses = "";
  let iconWrapperClasses = style.iconClassName;

  switch (provider) {
    case 'google': {
      buttonClasses = "bg-white hover:bg-zinc-50 text-black border border-border shadow-sm";
      break;
    }
    case 'github': {
      buttonClasses = "bg-[#24292e] hover:bg-[#1f2327] text-white border border-[#1b1f23] shadow-sm";
      iconWrapperClasses = "invert-0";
      break;
    }
    case 'facebook': {
      buttonClasses = "bg-[#1877F2] hover:bg-[#166fe5] text-white border border-[#1464d3] shadow-sm";
      iconWrapperClasses = "invert-0";
      break;
    }
    case 'microsoft': {
      buttonClasses = "bg-[#2f2f2f] hover:bg-[#252525] text-white border border-[#202020] shadow-sm";
      break;
    }
    case 'spotify': {
      buttonClasses = "bg-[#1ED760] hover:bg-[#1db954] text-black border border-[#1aa34a] shadow-sm";
      iconWrapperClasses = "invert dark:invert";
      break;
    }
    case 'discord': {
      buttonClasses = "bg-[#5865F2] hover:bg-[#4752c4] text-white border border-[#3c45b0] shadow-sm";
      iconWrapperClasses = "invert-0";
      break;
    }
    case 'apple': {
      buttonClasses = "bg-black dark:bg-white hover:bg-zinc-900 dark:hover:bg-zinc-100 text-white dark:text-black border border-zinc-900 dark:border-zinc-200 shadow-sm";
      iconWrapperClasses = "invert-0 dark:invert";
      break;
    }
    case 'gitlab': {
      buttonClasses = "bg-[#FC6D26] hover:bg-[#e24329] text-white border border-[#d13b1f] shadow-sm";
      break;
    }
    case 'bitbucket': {
      buttonClasses = "bg-[#0052CC] hover:bg-[#0047b3] text-white border border-[#003d99] shadow-sm";
      break;
    }
    case 'linkedin': {
      buttonClasses = "bg-[#0077B5] hover:bg-[#006699] text-white border border-[#005580] shadow-sm";
      iconWrapperClasses = "invert-0";
      break;
    }
    case 'x': {
      buttonClasses = "bg-black dark:bg-white hover:bg-zinc-900 dark:hover:bg-zinc-100 text-white dark:text-black border border-zinc-900 dark:border-zinc-200 shadow-sm";
      iconWrapperClasses = "invert-0 dark:invert";
      break;
    }
    case 'twitch': {
      buttonClasses = "bg-[#9146FF] hover:bg-[#772ce8] text-white border border-[#641bdf] shadow-sm";
      iconWrapperClasses = "invert-0";
      break;
    }
    default: {
      buttonClasses = "bg-primary hover:bg-primary/90 text-primary-foreground border border-transparent shadow-sm";
      break;
    }
  }

  return (
    <SimpleTooltip
      disabled={!isIframe}
      tooltip={isIframe ? "This auth provider is not supported in an iframe for security reasons." : undefined}
      className='stack-scope w-full inline-flex overflow-visible'
    >
      <Button
        onClick={async () => {
          localStorage.setItem('_HEXCLAVE.lastUsed', provider);
          await (onAuthenticate ? onAuthenticate() : hexclaveApp.signInWithOAuth(provider));
        }}
        variant="plain"
        className={`stack-scope relative overflow-visible w-full h-10 rounded-xl font-medium transition-all duration-150 ${buttonClasses}`}
        disabled={isIframe}
      >
        {!isMock && lastUsed === provider && (
          <Badge
            variant="secondary"
            className="absolute top-0 right-3 z-10 -translate-y-1/2 px-1.5 py-0 text-[10px] font-medium normal-case border border-blue-500/70 bg-blue-600 text-white shadow-sm dark:border-blue-400/70 dark:bg-blue-500 dark:text-white"
          >
            {t('last used')}
          </Badge>
        )}
        <div className='flex items-center w-full gap-3'>
          <span className={iconWrapperClasses}>{style.icon}</span>
          <span className='flex-1 text-sm'>
            {type === 'sign-up' ?
              t('Sign up with {provider}', { provider: style.name }) :
              t('Sign in with {provider}', { provider: style.name })
            }
          </span>
        </div>
      </Button>
    </SimpleTooltip>
  );
}
