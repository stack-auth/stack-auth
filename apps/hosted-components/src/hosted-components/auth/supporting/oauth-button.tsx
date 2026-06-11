import { useStackApp } from "@hexclave/react";
import type { ReactElement } from "react";
import { useEffect, useState } from "react";

import * as BrandIcons from "~/components/brand-icons";
import { Badge, Button, SimpleTooltip, cn } from "~/components/ui";

import type { AuthProject, AuthType } from "./types";
import { useInIframe } from "./utils";

const providerButtonClassNames = new Map<string, string>([
  ["google", "bg-white text-black hover:bg-zinc-50 border border-border shadow-sm"],
  ["github", "bg-[#24292e] text-white hover:bg-[#1f2327] border border-[#1b1f23] shadow-sm"],
  ["facebook", "bg-[#1877F2] text-white hover:bg-[#166fe5] border border-[#1464d3] shadow-sm"],
  ["microsoft", "bg-[#2f2f2f] text-white hover:bg-[#252525] border border-[#202020] shadow-sm"],
  ["spotify", "bg-[#1ED760] text-black hover:bg-[#1db954] border border-[#1aa34a] shadow-sm"],
  ["discord", "bg-[#5865F2] text-white hover:bg-[#4752c4] border border-[#3c45b0] shadow-sm"],
  ["apple", "bg-black text-white hover:bg-zinc-900 dark:bg-white dark:text-black dark:hover:bg-zinc-100 border border-zinc-900 dark:border-zinc-200 shadow-sm"],
  ["x", "bg-black text-white hover:bg-zinc-900 dark:bg-white dark:text-black dark:hover:bg-zinc-100 border border-zinc-900 dark:border-zinc-200 shadow-sm"],
  ["gitlab", "bg-[#FC6D26] text-white hover:bg-[#e24329] border border-[#d13b1f] shadow-sm"],
  ["bitbucket", "bg-[#0052CC] text-white hover:bg-[#0047b3] border border-[#003d99] shadow-sm"],
  ["linkedin", "bg-[#0077B5] text-white hover:bg-[#006699] border border-[#005580] shadow-sm"],
  ["twitch", "bg-[#9146FF] text-white hover:bg-[#772ce8] border border-[#641bdf] shadow-sm"],
]);

function getProviderStyle(provider: string): {
  name: string,
  icon: ReactElement | null,
  iconClassName?: string,
} {
  const iconSize = 20;

  switch (provider) {
    case "google": {
      return { name: "Google", icon: <BrandIcons.Google iconSize={iconSize} /> };
    }
    case "github": {
      return { name: "GitHub", icon: <BrandIcons.GitHub iconSize={iconSize} />, iconClassName: "invert dark:invert-0" };
    }
    case "facebook": {
      return { name: "Facebook", icon: <BrandIcons.Facebook iconSize={iconSize} />, iconClassName: "invert dark:invert-0" };
    }
    case "microsoft": {
      return { name: "Microsoft", icon: <BrandIcons.Microsoft iconSize={iconSize} /> };
    }
    case "spotify": {
      return { name: "Spotify", icon: <BrandIcons.Spotify iconSize={iconSize} />, iconClassName: "invert dark:invert-0" };
    }
    case "discord": {
      return { name: "Discord", icon: <BrandIcons.Discord iconSize={iconSize} />, iconClassName: "invert dark:invert-0" };
    }
    case "gitlab": {
      return { name: "Gitlab", icon: <BrandIcons.Gitlab iconSize={iconSize} /> };
    }
    case "apple": {
      return { name: "Apple", icon: <BrandIcons.Apple iconSize={iconSize} />, iconClassName: "invert dark:invert-0" };
    }
    case "bitbucket": {
      return { name: "Bitbucket", icon: <BrandIcons.Bitbucket iconSize={iconSize} /> };
    }
    case "linkedin": {
      return { name: "LinkedIn", icon: <BrandIcons.LinkedIn iconSize={iconSize} />, iconClassName: "invert dark:invert-0" };
    }
    case "x": {
      return { name: "X", icon: <BrandIcons.X iconSize={iconSize} />, iconClassName: "invert dark:invert-0" };
    }
    case "twitch": {
      return { name: "Twitch", icon: <BrandIcons.Twitch iconSize={iconSize} /> };
    }
    default: {
      return { name: provider, icon: null };
    }
  }
}

function getProviderButtonClassName(provider: string) {
  return providerButtonClassNames.get(provider) ?? "bg-primary text-primary-foreground hover:bg-primary/90 border border-transparent shadow-sm";
}

export function OAuthButton(props: {
  provider: string,
  type: AuthType,
  isMock?: boolean,
}) {
  const app = useStackApp();
  const inIframe = useInIframe();
  const [lastUsed, setLastUsed] = useState<string | null>(null);
  const style = getProviderStyle(props.provider);
  let iconWrapperClasses = style.iconClassName;

  if (["github", "facebook", "discord", "linkedin", "twitch"].includes(props.provider)) {
    iconWrapperClasses = "invert-0";
  } else if (props.provider === "spotify") {
    iconWrapperClasses = "invert dark:invert";
  } else if (props.provider === "apple" || props.provider === "x") {
    iconWrapperClasses = "invert-0 dark:invert";
  }

  useEffect(() => {
    setLastUsed(localStorage.getItem("_HEXCLAVE.lastUsed"));
  }, []);

  return (
    <SimpleTooltip
      disabled={!inIframe}
      tooltip={inIframe ? "This auth provider is not supported in an iframe for security reasons." : undefined}
      className="stack-scope inline-flex w-full overflow-visible"
    >
      <Button
        onClick={async () => {
          localStorage.setItem("_HEXCLAVE.lastUsed", props.provider);
          await app.signInWithOAuth(props.provider);
        }}
        variant="plain"
        className={cn("stack-scope relative h-10 w-full overflow-visible rounded-xl font-medium transition-all duration-150", getProviderButtonClassName(props.provider))}
        disabled={inIframe}
      >
        {!props.isMock && lastUsed === props.provider && (
          <Badge
            variant="secondary"
            className="absolute right-3 top-0 z-10 -translate-y-1/2 border border-blue-500/70 bg-blue-600 px-1.5 py-0 text-[10px] font-medium normal-case text-white shadow-sm dark:border-blue-400/70 dark:bg-blue-500"
          >
            last used
          </Badge>
        )}
        <div className="flex w-full items-center gap-3">
          <span className={iconWrapperClasses}>{style.icon}</span>
          <span className="flex-1 text-sm">
            {props.type === "sign-up" ? `Sign up with ${style.name}` : `Sign in with ${style.name}`}
          </span>
        </div>
      </Button>
    </SimpleTooltip>
  );
}

export function OAuthButtonGroup(props: {
  type: AuthType,
  mockProject?: AuthProject,
}) {
  const app = useStackApp();
  const project = props.mockProject ?? app.useProject();

  return (
    <div className="stack-scope flex flex-col items-stretch gap-3">
      {project.config.oauthProviders.map((provider) => (
        <OAuthButton
          key={provider.id}
          provider={provider.id}
          type={props.type}
          isMock={props.mockProject != null}
        />
      ))}
    </div>
  );
}
