"use client";

import { BrandIcons, Button, Input, Label, Separator, Tabs, TabsContent, TabsList, TabsTrigger, Typography, cn } from "@/components/ui";
import { KeyIcon } from "@phosphor-icons/react";
import type { ReactElement, ReactNode } from "react";

type HostedPreviewOAuthProvider = {
  id: string,
};

type HostedAuthPreviewProject = {
  displayName?: string,
  config: {
    signUpEnabled: boolean,
    credentialEnabled: boolean,
    passkeyEnabled: boolean,
    magicLinkEnabled: boolean,
    oauthProviders: HostedPreviewOAuthProvider[],
  },
};

type HostedAuthType = "sign-in" | "sign-up";

const authTabsListClassName = "mb-4 h-10 w-full rounded-lg border border-black/[0.08] bg-zinc-100/70 p-1 dark:border-white/[0.10] dark:bg-zinc-900/45";
const authTabsTriggerClassName = "h-8 flex-1 rounded-md py-0 text-sm font-medium text-muted-foreground transition-colors duration-300 hover:text-foreground/90 data-[state=active]:font-semibold data-[state=active]:text-foreground";
const authFooterClassName = "mt-6 border-t border-black/[0.06] pt-5 text-center text-sm dark:border-white/[0.10]";
const authFooterLinkClassName = "font-medium text-foreground/90 underline-offset-4 transition-colors hover:text-foreground hover:underline";

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

function getProviderButtonClassName(provider: string) {
  return providerButtonClassNames.get(provider) ?? "bg-primary text-primary-foreground hover:bg-primary/90 border border-transparent shadow-sm";
}

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
      return { name: "GitHub", icon: <BrandIcons.GitHub iconSize={iconSize} />, iconClassName: "invert-0" };
    }
    case "facebook": {
      return { name: "Facebook", icon: <BrandIcons.Facebook iconSize={iconSize} />, iconClassName: "invert-0" };
    }
    case "microsoft": {
      return { name: "Microsoft", icon: <BrandIcons.Microsoft iconSize={iconSize} /> };
    }
    case "spotify": {
      return { name: "Spotify", icon: <BrandIcons.Spotify iconSize={iconSize} />, iconClassName: "invert dark:invert" };
    }
    case "discord": {
      return { name: "Discord", icon: <BrandIcons.Discord iconSize={iconSize} />, iconClassName: "invert-0" };
    }
    case "gitlab": {
      return { name: "GitLab", icon: <BrandIcons.Gitlab iconSize={iconSize} /> };
    }
    case "apple": {
      return { name: "Apple", icon: <BrandIcons.Apple iconSize={iconSize} />, iconClassName: "invert-0 dark:invert" };
    }
    case "bitbucket": {
      return { name: "Bitbucket", icon: <BrandIcons.Bitbucket iconSize={iconSize} /> };
    }
    case "linkedin": {
      return { name: "LinkedIn", icon: <BrandIcons.LinkedIn iconSize={iconSize} />, iconClassName: "invert-0" };
    }
    case "x": {
      return { name: "X", icon: <BrandIcons.X iconSize={iconSize} />, iconClassName: "invert-0 dark:invert" };
    }
    case "twitch": {
      return { name: "Twitch", icon: <BrandIcons.Twitch iconSize={iconSize} />, iconClassName: "invert-0" };
    }
    default: {
      return { name: provider, icon: null };
    }
  }
}

function PreviewFrame(props: {
  children: ReactNode,
  className?: string,
}) {
  return (
    <div className={cn("auth-preview-host-theme stack-scope flex w-full justify-center", props.className)}>
      <div className="stack-scope relative z-10 flex w-full max-w-[400px] flex-col items-stretch text-foreground">
        {props.children}
      </div>
    </div>
  );
}

function HostedAuthHeading(props: {
  title: string,
  children?: ReactNode,
}) {
  return (
    <div className="mb-6 text-center">
      <Typography type="h2" className="mb-1 text-xl font-semibold tracking-tight">{props.title}</Typography>
      {props.children != null && (
        <Typography className="text-sm text-muted-foreground">{props.children}</Typography>
      )}
    </div>
  );
}

function SeparatorWithText(props: {
  text: string,
}) {
  return (
    <div className="stack-scope my-6 flex items-center justify-center">
      <div className="flex-1">
        <Separator />
      </div>
      <div className="mx-2 text-sm text-muted-foreground">{props.text}</div>
      <div className="flex-1">
        <Separator />
      </div>
    </div>
  );
}

function OAuthPreviewButton(props: {
  provider: string,
  type: HostedAuthType,
}) {
  const style = getProviderStyle(props.provider);
  return (
    <Button
      variant="plain"
      tabIndex={-1}
      className={cn("stack-scope relative h-10 w-full overflow-visible rounded-xl font-medium transition-all duration-150", getProviderButtonClassName(props.provider))}
    >
      <div className="flex w-full items-center gap-3">
        <span className={style.iconClassName}>{style.icon}</span>
        <span className="flex-1 text-sm">
          {props.type === "sign-up" ? `Sign up with ${style.name}` : `Sign in with ${style.name}`}
        </span>
      </div>
    </Button>
  );
}

function OAuthPreviewButtonGroup(props: {
  providers: HostedPreviewOAuthProvider[],
  type: HostedAuthType,
}) {
  return (
    <div className="stack-scope flex flex-col items-stretch gap-3">
      {props.providers.map((provider) => (
        <OAuthPreviewButton key={provider.id} provider={provider.id} type={props.type} />
      ))}
    </div>
  );
}

function PasskeyPreviewButton(props: {
  type: HostedAuthType,
}) {
  return (
    <Button
      variant="plain"
      tabIndex={-1}
      className="stack-scope h-10 rounded-xl border border-transparent bg-primary font-medium text-primary-foreground shadow-sm transition-all duration-150 hover:bg-primary/90"
    >
      <div className="flex w-full items-center gap-4">
        <KeyIcon className="size-5" />
        <span className="flex-1">
          {props.type === "sign-up" ? "Sign up with Passkey" : "Sign in with Passkey"}
        </span>
      </div>
    </Button>
  );
}

function HostedMagicLinkPreviewForm() {
  return (
    <form className="stack-scope flex flex-col items-stretch" noValidate>
      <Label htmlFor="hosted-preview-email" className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Email</Label>
      <Input
        id="hosted-preview-email"
        type="email"
        autoComplete="email"
        className="h-10 rounded-xl border-border bg-background"
        tabIndex={-1}
      />
      <Button type="button" className="mt-6 h-10 rounded-xl font-semibold shadow-sm hover:shadow" tabIndex={-1}>
        Send email
      </Button>
    </form>
  );
}

function HostedCredentialPreviewForm(props: {
  type: HostedAuthType,
}) {
  return (
    <form className="stack-scope flex flex-col items-stretch" noValidate>
      <Label htmlFor="hosted-preview-email-password-email" className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Email</Label>
      <Input
        id="hosted-preview-email-password-email"
        type="email"
        autoComplete="email"
        className="h-10 rounded-xl border-border bg-background"
        tabIndex={-1}
      />

      <div className="mb-1.5 mt-4 flex items-center justify-between">
        <Label htmlFor="hosted-preview-email-password-password" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Password</Label>
        {props.type === "sign-in" && (
          <a href="#" className="text-xs text-muted-foreground hover:text-foreground" tabIndex={-1}>
            Forgot password?
          </a>
        )}
      </div>
      <Input
        id="hosted-preview-email-password-password"
        type="password"
        autoComplete={props.type === "sign-in" ? "current-password" : "new-password"}
        className="h-10 rounded-xl border-border bg-background"
        tabIndex={-1}
      />

      <Button type="button" className="mt-6 h-10 rounded-xl font-semibold shadow-sm hover:shadow" tabIndex={-1}>
        {props.type === "sign-in" ? "Sign In" : "Sign Up"}
      </Button>
    </form>
  );
}

export function HostedAuthMethodPreview(props: {
  project: HostedAuthPreviewProject,
  type?: HostedAuthType,
  firstTab?: "magic-link" | "password",
  className?: string,
}) {
  const type = props.type ?? "sign-in";
  const hasOAuthProviders = props.project.config.oauthProviders.length > 0;
  const hasPasskey = props.project.config.passkeyEnabled === true && type === "sign-in";
  const hasEmailMethods = props.project.config.credentialEnabled || props.project.config.magicLinkEnabled;
  const enableSeparator = hasEmailMethods && (hasOAuthProviders || hasPasskey);

  return (
    <PreviewFrame className={props.className}>
      <HostedAuthHeading title={type === "sign-in" ? "Sign in" : "Create account"}>
        {type === "sign-in" ? (
          <>
            to continue to <span className="font-medium text-foreground">{props.project.displayName}</span>
          </>
        ) : (
          <>
            to get started with <span className="font-medium text-foreground">{props.project.displayName}</span>
          </>
        )}
      </HostedAuthHeading>

      {(hasOAuthProviders || hasPasskey) && (
        <div className="mb-2 flex flex-col items-stretch gap-3">
          {hasOAuthProviders && <OAuthPreviewButtonGroup providers={props.project.config.oauthProviders} type={type} />}
          {hasPasskey && <PasskeyPreviewButton type={type} />}
        </div>
      )}

      {enableSeparator && <SeparatorWithText text="Or continue with" />}

      {props.project.config.credentialEnabled && props.project.config.magicLinkEnabled ? (
        <Tabs defaultValue={props.firstTab || "magic-link"} className="w-full">
          <TabsList className={cn(authTabsListClassName, {
            "flex-row-reverse": props.firstTab === "password",
          })}>
            <TabsTrigger value="magic-link" className={authTabsTriggerClassName} tabIndex={-1}>Email</TabsTrigger>
            <TabsTrigger value="password" className={authTabsTriggerClassName} tabIndex={-1}>Email & Password</TabsTrigger>
          </TabsList>
          <TabsContent value="magic-link" className="focus-visible:outline-none focus-visible:ring-0">
            <HostedMagicLinkPreviewForm />
          </TabsContent>
          <TabsContent value="password" className="focus-visible:outline-none focus-visible:ring-0">
            <HostedCredentialPreviewForm type={type} />
          </TabsContent>
        </Tabs>
      ) : props.project.config.credentialEnabled ? (
        <HostedCredentialPreviewForm type={type} />
      ) : props.project.config.magicLinkEnabled ? (
        <HostedMagicLinkPreviewForm />
      ) : !(hasOAuthProviders || hasPasskey) ? (
        <p className="py-4 text-center text-sm text-destructive">No authentication method enabled.</p>
      ) : null}

      <div className={authFooterClassName}>
        {type === "sign-in" ? (
          props.project.config.signUpEnabled && (
            <p className="text-muted-foreground">
              Don&apos;t have an account?{" "}
              <a href="#" className={authFooterLinkClassName} tabIndex={-1}>
                Sign up
              </a>
            </p>
          )
        ) : (
          <p className="text-muted-foreground">
            Already have an account?{" "}
            <a href="#" className={authFooterLinkClassName} tabIndex={-1}>
              Sign in
            </a>
          </p>
        )}
      </div>
    </PreviewFrame>
  );
}
