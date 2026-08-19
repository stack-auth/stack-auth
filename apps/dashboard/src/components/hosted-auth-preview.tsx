"use client";

import { BrandIcons, Button, Input, Label, Separator, Typography, cn } from "@/components/ui";
import { KeyIcon } from "@phosphor-icons/react";
import React, { useCallback, useLayoutEffect, useMemo, useRef, useState, type HTMLAttributes, type ReactElement, type ReactNode } from "react";

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
const authInputClassName = "h-9 rounded-lg border-black/[0.08] bg-white/45 px-3 py-1 text-sm shadow-none ring-0 placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring dark:border-white/[0.15] dark:bg-zinc-900/50";

type HostedPreviewTabsContextValue = {
  value: string,
  setValue: (value: string) => void,
};

const HostedPreviewTabsContext = React.createContext<HostedPreviewTabsContextValue | null>(null);

function useHostedPreviewTabsContext() {
  const context = React.useContext(HostedPreviewTabsContext);
  if (context == null) {
    throw new Error("Hosted preview tabs components must be rendered inside HostedPreviewTabs");
  }
  return context;
}

function HostedPreviewTabs({ defaultValue, ...rest }: HTMLAttributes<HTMLDivElement> & {
  defaultValue: string,
}) {
  const [value, setValue] = useState(defaultValue);
  const contextValue = useMemo<HostedPreviewTabsContextValue>(() => ({
    value,
    setValue,
  }), [value]);

  return (
    <HostedPreviewTabsContext.Provider value={contextValue}>
      <div {...rest} />
    </HostedPreviewTabsContext.Provider>
  );
}

function HostedPreviewTabsList({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) {
  const tabs = useHostedPreviewTabsContext();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [indicatorStyle, setIndicatorStyle] = useState<{ left: number, top: number, width: number, height: number } | null>(null);

  const measure = useCallback(() => {
    const container = containerRef.current;
    if (container == null) {
      return;
    }
    const activeTab = container.querySelector<HTMLElement>('[role="tab"][data-state="active"]');
    if (activeTab == null) {
      setIndicatorStyle(null);
      return;
    }
    setIndicatorStyle({
      left: activeTab.offsetLeft,
      top: activeTab.offsetTop,
      width: activeTab.offsetWidth,
      height: activeTab.offsetHeight,
    });
  }, []);

  useLayoutEffect(() => {
    measure();
  }, [measure, tabs.value]);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (container == null || typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(() => measure());
    observer.observe(container);
    return () => observer.disconnect();
  }, [measure]);

  const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    const container = containerRef.current;
    if (container == null) {
      return;
    }
    const tabs = Array.from(container.querySelectorAll<HTMLElement>('[role="tab"]'));
    const currentIndex = tabs.findIndex((tab) => tab === document.activeElement);
    if (currentIndex === -1) {
      return;
    }
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight") {
      nextIndex = (currentIndex + 1) % tabs.length;
    } else if (event.key === "ArrowLeft") {
      nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = tabs.length - 1;
    }
    if (nextIndex != null) {
      event.preventDefault();
      tabs[nextIndex].focus();
      tabs[nextIndex].click();
    }
  }, []);

  return (
    <div
      ref={containerRef}
      role="tablist"
      className={cn("stack-scope relative inline-flex h-9 items-center justify-center rounded-lg border border-black/[0.08] bg-zinc-100/70 p-1 text-muted-foreground dark:border-white/[0.10] dark:bg-zinc-900/45", className)}
      onKeyDown={handleKeyDown}
      {...props}
    >
      {indicatorStyle != null && (
        <div
          aria-hidden
          className="pointer-events-none absolute rounded-md border border-black/[0.08] bg-white/80 shadow-sm transition-[left,top,width,height] duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] dark:border-white/[0.10] dark:bg-zinc-800/80 dark:ring-1 dark:ring-white/[0.06]"
          style={indicatorStyle}
        />
      )}
      {children}
    </div>
  );
}

function HostedPreviewTabsTrigger({ className, value, onClick, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  value: string,
}) {
  const tabs = useHostedPreviewTabsContext();
  const active = tabs.value === value;
  const tabId = `hosted-preview-tab-${value}`;
  const panelId = `hosted-preview-panel-${value}`;

  return (
    <button
      type="button"
      role="tab"
      id={tabId}
      aria-selected={active}
      aria-controls={panelId}
      tabIndex={active ? 0 : -1}
      data-state={active ? "active" : "inactive"}
      className={cn(
        "relative z-10 inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1 text-sm font-medium text-muted-foreground ring-offset-background transition-colors duration-300 hover:text-foreground/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:font-semibold data-[state=active]:text-foreground",
        className,
      )}
      onClick={(event) => {
        tabs.setValue(value);
        onClick?.(event);
      }}
      {...props}
    />
  );
}

function HostedPreviewTabsContent({ className, value, ...props }: HTMLAttributes<HTMLDivElement> & {
  value: string,
}) {
  const tabs = useHostedPreviewTabsContext();
  if (tabs.value !== value) {
    return null;
  }

  const panelId = `hosted-preview-panel-${value}`;
  const tabId = `hosted-preview-tab-${value}`;

  return (
    <div
      role="tabpanel"
      id={panelId}
      aria-labelledby={tabId}
      data-state="active"
      className={cn("mt-2 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2", className)}
      {...props}
    />
  );
}

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
      type="button"
      variant="plain"
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
      type="button"
      variant="plain"
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
    <form className="stack-scope flex flex-col items-stretch" noValidate onSubmit={(event) => event.preventDefault()}>
      <Label htmlFor="hosted-preview-email" className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Email</Label>
      <Input
        id="hosted-preview-email"
        type="email"
        autoComplete="email"
        className={authInputClassName}
      />
      <Button type="button" className="mt-6 h-10 rounded-xl font-semibold shadow-sm hover:shadow">
        Send email
      </Button>
    </form>
  );
}

function HostedCredentialPreviewForm(props: {
  type: HostedAuthType,
}) {
  return (
    <form className="stack-scope flex flex-col items-stretch" noValidate onSubmit={(event) => event.preventDefault()}>
      <Label htmlFor="hosted-preview-email-password-email" className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Email</Label>
      <Input
        id="hosted-preview-email-password-email"
        type="email"
        autoComplete="email"
        className={authInputClassName}
      />

      <div className="mb-1.5 mt-4 flex items-center justify-between">
        <Label htmlFor="hosted-preview-email-password-password" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Password</Label>
        {props.type === "sign-in" && (
          <a href="#" className="text-xs text-muted-foreground hover:text-foreground" onClick={(event) => event.preventDefault()}>
            Forgot password?
          </a>
        )}
      </div>
      <Input
        id="hosted-preview-email-password-password"
        type="password"
        autoComplete={props.type === "sign-in" ? "current-password" : "new-password"}
        className={authInputClassName}
      />

      <Button type="button" className="mt-6 h-10 rounded-xl font-semibold shadow-sm hover:shadow">
        {props.type === "sign-in" ? "Sign In" : "Sign Up"}
      </Button>
    </form>
  );
}

/**
 * Mirrors the `HostedNoAuthMethods` component of the hosted components app, so that the dashboard preview
 * shows developers exactly what their end users would see when no auth method is enabled.
 */
function NoAuthMethodsPreview(props: {
  projectDisplayName?: string,
}) {
  return (
    <>
      <div className="flex flex-col items-center text-center">
        <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-2xl border border-black/[0.08] bg-zinc-100/70 dark:border-white/[0.10] dark:bg-zinc-900/45">
          <KeyIcon className="h-5 w-5 text-muted-foreground" />
        </div>
        <Typography type="h2" className="mb-1 text-xl font-semibold tracking-tight">Sign-in is not available</Typography>
        <Typography className="text-sm text-muted-foreground">
          {props.projectDisplayName == null
            ? "This app has no authentication methods enabled, so nobody can sign in yet."
            : <>
              <span className="font-medium text-foreground">{props.projectDisplayName}</span> has no authentication methods enabled, so nobody can sign in yet.
            </>}
        </Typography>
      </div>

      <div className="mt-6 rounded-xl border border-black/[0.08] bg-zinc-100/50 p-4 text-left dark:border-white/[0.10] dark:bg-zinc-900/45">
        <p className="text-sm font-semibold">Are you the developer?</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Enable at least one sign-in method in your <code className="rounded bg-black/[0.06] px-1 py-0.5 font-mono text-xs dark:bg-white/[0.10]">hexclave.config.ts</code>, or right here in the dashboard.
        </p>
      </div>
    </>
  );
}

export function HostedAuthMethodPreview(props: {
  project: HostedAuthPreviewProject,
  type?: HostedAuthType,
  firstTab?: "magic-link" | "password",
  className?: string,
}) {
  const type = props.type ?? "sign-in";
  if (type === "sign-up" && !props.project.config.signUpEnabled) {
    return (
      <PreviewFrame className={props.className}>
        <HostedAuthHeading title="Sign up disabled">
          New account creation is disabled for this project.
        </HostedAuthHeading>
      </PreviewFrame>
    );
  }
  const hasOAuthProviders = props.project.config.oauthProviders.length > 0;
  const hasPasskey = props.project.config.passkeyEnabled === true && type === "sign-in";
  const hasEmailMethods = props.project.config.credentialEnabled || props.project.config.magicLinkEnabled;
  const enableSeparator = hasEmailMethods && (hasOAuthProviders || hasPasskey);
  const hasAnyAuthMethod = hasOAuthProviders || props.project.config.passkeyEnabled === true || hasEmailMethods;

  if (!hasAnyAuthMethod) {
    return (
      <PreviewFrame className={props.className}>
        <NoAuthMethodsPreview projectDisplayName={props.project.displayName} />
      </PreviewFrame>
    );
  }

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
        <HostedPreviewTabs defaultValue={props.firstTab || "magic-link"} className="w-full">
          <HostedPreviewTabsList className={cn(authTabsListClassName, {
            "flex-row-reverse": props.firstTab === "password",
          })}>
            <HostedPreviewTabsTrigger value="magic-link" className={authTabsTriggerClassName}>Email</HostedPreviewTabsTrigger>
            <HostedPreviewTabsTrigger value="password" className={authTabsTriggerClassName}>Email & Password</HostedPreviewTabsTrigger>
          </HostedPreviewTabsList>
          <HostedPreviewTabsContent value="magic-link" className="focus-visible:outline-none focus-visible:ring-0">
            <HostedMagicLinkPreviewForm />
          </HostedPreviewTabsContent>
          <HostedPreviewTabsContent value="password" className="focus-visible:outline-none focus-visible:ring-0">
            <HostedCredentialPreviewForm type={type} />
          </HostedPreviewTabsContent>
        </HostedPreviewTabs>
      ) : props.project.config.credentialEnabled ? (
        <HostedCredentialPreviewForm type={type} />
      ) : props.project.config.magicLinkEnabled ? (
        <HostedMagicLinkPreviewForm />
      ) : !(hasOAuthProviders || hasPasskey) ? (
        <p className="py-2 text-center text-sm text-muted-foreground">
          New accounts can&apos;t be created with the sign-in methods enabled for this app. Sign in instead.
        </p>
      ) : null}

      {(type === "sign-up" || props.project.config.signUpEnabled) && (
        <div className={authFooterClassName}>
          {type === "sign-in" ? (
            <p className="text-muted-foreground">
              Don&apos;t have an account?{" "}
              <a href="#" className={authFooterLinkClassName} onClick={(event) => event.preventDefault()}>
                Sign up
              </a>
            </p>
          ) : (
            <p className="text-muted-foreground">
              Already have an account?{" "}
              <a href="#" className={authFooterLinkClassName} onClick={(event) => event.preventDefault()}>
                Sign in
              </a>
            </p>
          )}
        </div>
      )}
    </PreviewFrame>
  );
}
