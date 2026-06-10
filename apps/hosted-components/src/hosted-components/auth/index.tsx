import { KnownError, KnownErrors } from "@hexclave/shared";
import { getPasswordError } from "@hexclave/shared/dist/helpers/password";
import { runAsynchronously, runAsynchronouslyWithAlert } from "@hexclave/shared/dist/utils/promises";
import { useStackApp, useUser, useCliAuthConfirmation } from "@hexclave/react";
import { KeyRound, Check, Mail, AlertTriangle, ArrowRight } from "lucide-react";
import type { ReactElement } from "react";
import React, { Suspense, useEffect, useMemo, useState } from "react";

import * as BrandIcons from "~/components/brand-icons";
import {
  Badge,
  Button,
  Input,
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
  Label,
  PasswordInput,
  Separator,
  SimpleTooltip,
  Spinner,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Typography,
  cn,
} from "~/components/ui";

type AuthProject = {
  displayName?: string,
  config: {
    signUpEnabled: boolean,
    credentialEnabled: boolean,
    passkeyEnabled: boolean,
    magicLinkEnabled: boolean,
    oauthProviders: {
      id: string,
    }[],
  },
};

type AuthType = "sign-in" | "sign-up";

type AutomaticRedirectResult =
  | { status: "success" }
  | { status: "error" };

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

function getSearchParams(): Partial<Record<string, string>> {
  if (typeof window === "undefined") {
    return {};
  }

  const params: Partial<Record<string, string>> = {};
  new URLSearchParams(window.location.search).forEach((value, key) => {
    params[key] = value;
  });
  return params;
}

function HostedAuthShell(props: {
  children: React.ReactNode,
  fullPage?: boolean,
  paddedFullPage?: boolean,
}) {
  const content = (
    <div
      className={cn(
        "stack-scope relative z-10 flex w-full max-w-[400px] flex-col items-stretch text-foreground",
        props.fullPage && props.paddedFullPage !== false ? "p-4 sm:p-6" : "p-0",
      )}
    >
      {props.children}
    </div>
  );

  if (!props.fullPage) {
    return content;
  }

  return (
    <div
      data-hexclave-handler-page
      className="stack-scope relative flex min-h-screen w-full items-center justify-center overflow-hidden bg-background p-4 sm:p-6"
    >
      {content}
    </div>
  );
}

function HostedAuthHeading(props: {
  title: string,
  children?: React.ReactNode,
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

function HostedAuthMessage(props: {
  title: string,
  children: React.ReactNode,
  primaryAction: () => Promise<void> | void,
  primaryText: string,
  secondaryAction?: () => Promise<void> | void,
  secondaryText?: string,
  fullPage?: boolean,
}) {
  return (
    <HostedAuthShell fullPage={props.fullPage}>
      <div className="text-center">
        <Typography type="h2" className="mb-2 text-xl font-semibold tracking-tight">{props.title}</Typography>
        <Typography className="text-sm text-muted-foreground">{props.children}</Typography>
      </div>
      <div className="mt-6 flex flex-col gap-2.5">
        <Button onClick={props.primaryAction} className="h-10 rounded-xl font-semibold shadow-sm hover:shadow">
          {props.primaryText}
        </Button>
        {props.secondaryAction != null && props.secondaryText != null && (
          <Button variant="secondary" onClick={props.secondaryAction} className="h-10 rounded-xl font-semibold">
            {props.secondaryText}
          </Button>
        )}
      </div>
    </HostedAuthShell>
  );
}

function HostedAuthLoading(props: {
  fullPage?: boolean,
}) {
  return (
    <HostedAuthShell fullPage={props.fullPage}>
      <div className="flex min-h-24 items-center justify-center">
        <Spinner size={24} className="text-muted-foreground" />
      </div>
    </HostedAuthShell>
  );
}

function HostedAuthFallback(props: {
  fullPage?: boolean,
}) {
  const content = (
    <div className="stack-scope flex w-full max-w-[400px] flex-col items-stretch p-4 sm:p-6">
      <div className="mb-6 flex flex-col items-center text-center">
        <div className="hosted-skeleton h-6 w-40 rounded-lg" />
        <div className="hosted-skeleton mt-2 h-3 w-56 rounded-full" />
      </div>
      <div className="space-y-4">
        <div className="space-y-1.5">
          <div className="hosted-skeleton h-3 w-16 rounded-full" />
          <div className="hosted-skeleton h-10 w-full rounded-xl" />
        </div>
        <div className="space-y-1.5">
          <div className="hosted-skeleton h-3 w-24 rounded-full" />
          <div className="hosted-skeleton h-10 w-full rounded-xl" />
        </div>
        <div className="hosted-skeleton h-10 w-full rounded-xl" />
      </div>
    </div>
  );

  if (!props.fullPage) {
    return content;
  }

  return (
    <div
      data-hexclave-handler-page
      className="stack-scope flex min-h-screen w-full items-center justify-center bg-background p-4 sm:p-6"
    >
      {content}
    </div>
  );
}

function FormWarningText(props: {
  text?: string | null,
}) {
  if (props.text == null || props.text.length === 0) {
    return null;
  }

  return (
    <p role="alert" className="mt-1.5 text-xs text-destructive">
      {props.text}
    </p>
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

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
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

function useInIframe() {
  const [inIframe, setInIframe] = useState(false);

  useEffect(() => {
    setInIframe(window.self !== window.top);
  }, []);

  return inIframe;
}

function OAuthButton(props: {
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

function OAuthButtonGroup(props: {
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

function PasskeyButton(props: {
  type: AuthType,
}) {
  const app = useStackApp();

  return (
    <Button
      onClick={async () => {
        await app.signInWithPasskey();
      }}
      variant="plain"
      className="stack-scope h-10 rounded-xl border border-transparent bg-primary font-medium text-primary-foreground shadow-sm transition-all duration-150 hover:bg-primary/90"
    >
      <div className="flex w-full items-center gap-4">
        <KeyRound className="size-5" />
        <span className="flex-1">
          {props.type === "sign-up" ? "Sign up with Passkey" : "Sign in with Passkey"}
        </span>
      </div>
    </Button>
  );
}

function CredentialSignIn() {
  const app = useStackApp();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [emailError, setEmailError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit() {
    setEmailError(null);
    setPasswordError(null);
    if (!isValidEmail(email)) {
      setEmailError("Please enter a valid email");
      return;
    }
    if (password.length === 0) {
      setPasswordError("Please enter your password");
      return;
    }

    setLoading(true);
    try {
      const result = await app.signInWithCredential({ email, password });
      if (result.status === "error") {
        setEmailError(result.error.message);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <form
      className="stack-scope flex flex-col items-stretch"
      onSubmit={(event) => {
        event.preventDefault();
        runAsynchronouslyWithAlert(submit());
      }}
      noValidate
    >
      <Label htmlFor="email" className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Email</Label>
      <Input
        id="email"
        type="email"
        autoComplete="email"
        className="h-10 rounded-xl border-border bg-background"
        value={email}
        onChange={(event) => {
          setEmail(event.target.value);
          setEmailError(null);
        }}
      />
      <FormWarningText text={emailError} />

      <div className="mb-1.5 mt-4 flex items-center justify-between">
        <Label htmlFor="password" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Password</Label>
        <a
          href={app.urls.forgotPassword}
          className="text-xs text-muted-foreground hover:text-foreground"
          onClick={(event) => {
            event.preventDefault();
            runAsynchronously(app.redirectToForgotPassword());
          }}
        >
          Forgot password?
        </a>
      </div>
      <PasswordInput
        id="password"
        autoComplete="current-password"
        className="h-10 rounded-xl border-border bg-background"
        value={password}
        onChange={(event) => {
          setPassword(event.target.value);
          setPasswordError(null);
        }}
      />
      <FormWarningText text={passwordError} />

      <Button type="submit" className="mt-6 h-10 rounded-xl font-semibold shadow-sm hover:shadow" loading={loading}>
        Sign In
      </Button>
    </form>
  );
}

function CredentialSignUp(props: {
  noPasswordRepeat?: boolean,
}) {
  const app = useStackApp();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordRepeat, setPasswordRepeat] = useState("");
  const [emailError, setEmailError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordRepeatError, setPasswordRepeatError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit() {
    setEmailError(null);
    setPasswordError(null);
    setPasswordRepeatError(null);
    if (!isValidEmail(email)) {
      setEmailError("Please enter a valid email");
      return;
    }
    const passwordValidationError = getPasswordError(password);
    if (password.length === 0) {
      setPasswordError("Please enter your password");
      return;
    }
    if (passwordValidationError != null) {
      setPasswordError(passwordValidationError.message);
      return;
    }
    if (!props.noPasswordRepeat && passwordRepeat !== password) {
      setPasswordRepeatError("Passwords do not match");
      return;
    }

    setLoading(true);
    try {
      const result = await app.signUpWithCredential({ email, password });
      if (result.status === "error") {
        setEmailError(result.error.message);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <form
      className="stack-scope flex flex-col items-stretch"
      onSubmit={(event) => {
        event.preventDefault();
        runAsynchronouslyWithAlert(submit());
      }}
      noValidate
    >
      <Label htmlFor="email" className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Email</Label>
      <Input
        id="email"
        type="email"
        autoComplete="email"
        className="h-10 rounded-xl border-border bg-background"
        value={email}
        onChange={(event) => {
          setEmail(event.target.value);
          setEmailError(null);
        }}
      />
      <FormWarningText text={emailError} />

      <Label htmlFor="password" className="mb-1.5 mt-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Password</Label>
      <PasswordInput
        id="password"
        autoComplete="new-password"
        className="h-10 rounded-xl border-border bg-background"
        value={password}
        onChange={(event) => {
          setPassword(event.target.value);
          setPasswordError(null);
          setPasswordRepeatError(null);
        }}
      />
      <FormWarningText text={passwordError} />

      {!props.noPasswordRepeat && (
        <>
          <Label htmlFor="repeat-password" className="mb-1.5 mt-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Repeat Password</Label>
          <PasswordInput
            id="repeat-password"
            autoComplete="new-password"
            className="h-10 rounded-xl border-border bg-background"
            value={passwordRepeat}
            onChange={(event) => {
              setPasswordRepeat(event.target.value);
              setPasswordError(null);
              setPasswordRepeatError(null);
            }}
          />
          <FormWarningText text={passwordRepeatError} />
        </>
      )}

      <Button type="submit" className="mt-6 h-10 rounded-xl font-semibold shadow-sm hover:shadow" loading={loading}>
        Sign Up
      </Button>
    </form>
  );
}

function MagicLinkOtp(props: {
  nonce: string,
  onBack: () => void,
}) {
  const app = useStackApp();
  const [otp, setOtp] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (otp.length !== 6 || submitting) {
      if (otp.length !== 0 && otp.length !== 6) {
        setError(null);
      }
      return;
    }

    setSubmitting(true);
    runAsynchronouslyWithAlert((async () => {
      try {
        const result = await app.signInWithMagicLink(otp + props.nonce);
        if (result.status === "error") {
          if (KnownErrors.VerificationCodeError.isInstance(result.error) || KnownErrors.InvalidTotpCode.isInstance(result.error)) {
            setError("Invalid code");
          } else {
            throw result.error;
          }
        }
      } finally {
        setSubmitting(false);
        setOtp("");
      }
    })());
  }, [app, otp, props.nonce, submitting]);

  return (
    <div className="stack-scope flex flex-col items-stretch">
      <form className="mb-4 flex w-full flex-col items-center">
        <Typography className="mb-4 text-center text-sm text-muted-foreground">Enter the code from your email</Typography>
        <InputOTP
          maxLength={6}
          type="text"
          inputMode="text"
          pattern="^[a-zA-Z0-9]+$"
          value={otp}
          onChange={(value) => setOtp(value.toUpperCase())}
          disabled={submitting}
        >
          <InputOTPGroup className="gap-2">
            {[0, 1, 2, 3, 4, 5].map((index) => (
              <InputOTPSlot key={index} index={index} size="lg" className="rounded-xl border border-border bg-background transition-all focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring" />
            ))}
          </InputOTPGroup>
        </InputOTP>
        <FormWarningText text={error} />
      </form>
      <Button variant="link" onClick={props.onBack} className="mt-2 text-xs text-muted-foreground hover:text-foreground">
        Cancel
      </Button>
    </div>
  );
}

function MagicLinkSignIn() {
  const app = useStackApp();
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState<string | null>(null);
  const [nonce, setNonce] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit() {
    setEmailError(null);
    if (!isValidEmail(email)) {
      setEmailError("Please enter a valid email");
      return;
    }

    setLoading(true);
    try {
      const result = await app.sendMagicLinkEmail(email);
      if (result.status === "error") {
        setEmailError(result.error.message);
        return;
      }
      setNonce(result.data.nonce);
    } catch (error) {
      if (KnownErrors.SignUpNotEnabled.isInstance(error)) {
        setEmailError("New account registration is not allowed");
      } else {
        throw error;
      }
    } finally {
      setLoading(false);
    }
  }

  if (nonce != null) {
    return <MagicLinkOtp nonce={nonce} onBack={() => setNonce(null)} />;
  }

  return (
    <form
      className="stack-scope flex flex-col items-stretch"
      onSubmit={(event) => {
        event.preventDefault();
        runAsynchronouslyWithAlert(submit());
      }}
      noValidate
    >
      <Label htmlFor="email" className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Email</Label>
      <Input
        id="email"
        type="email"
        autoComplete="email"
        className="h-10 rounded-xl border-border bg-background"
        value={email}
        onChange={(event) => {
          setEmail(event.target.value);
          setEmailError(null);
        }}
      />
      <FormWarningText text={emailError} />

      <Button type="submit" className="mt-6 h-10 rounded-xl font-semibold shadow-sm hover:shadow" loading={loading}>
        Send email
      </Button>
    </form>
  );
}

function AutomaticRedirect(props: {
  fullPage?: boolean,
  isRestricted: boolean,
  type: AuthType,
}) {
  const app = useStackApp();
  const redirectResultPromise = useMemo(async (): Promise<AutomaticRedirectResult> => {
    try {
      await (
        props.isRestricted
          ? app.redirectToOnboarding({ replace: true })
          : props.type === "sign-in"
            ? app.redirectToAfterSignIn({ replace: true })
            : app.redirectToAfterSignUp({ replace: true })
      );
      return { status: "success" };
    } catch (error) {
      return { status: "error" };
    }
  }, [app, props.isRestricted, props.type]);

  const [result, setResult] = useState<AutomaticRedirectResult | null>(null);
  useEffect(() => {
    runAsynchronouslyWithAlert(redirectResultPromise.then(setResult));
  }, [redirectResultPromise]);

  if (result?.status === "error") {
    return (
      <HostedAuthMessage
        title="Unable to redirect"
        primaryAction={() => app.redirectToHome()}
        primaryText="Go home"
        fullPage={props.fullPage}
      >
        We could not continue automatically. Please try again.
      </HostedAuthMessage>
    );
  }

  return (
    <HostedAuthLoading fullPage={props.fullPage} />
  );
}

function HostedAuthPageInner(props: {
  noPasswordRepeat?: boolean,
  firstTab?: "magic-link" | "password",
  fullPage?: boolean,
  type: AuthType,
  automaticRedirect?: boolean,
  extraInfo?: React.ReactNode,
  mockProject?: AuthProject,
}) {
  const app = useStackApp();
  const user = useUser({ includeRestricted: true });
  const projectFromHook = app.useProject();
  const project: AuthProject = props.mockProject ?? projectFromHook;

  if (props.automaticRedirect && user != null && props.mockProject == null) {
    return (
      <Suspense fallback={<HostedAuthLoading fullPage={props.fullPage} />}>
        <AutomaticRedirect fullPage={props.fullPage} isRestricted={user.isRestricted} type={props.type} />
      </Suspense>
    );
  }

  if (user != null && props.mockProject == null && !props.automaticRedirect) {
    return (
      <HostedAuthMessage
        title="You're already signed in"
        primaryAction={() => app.redirectToHome()}
        primaryText="Go home"
        secondaryAction={() => app.redirectToSignOut()}
        secondaryText="Sign out"
        fullPage={props.fullPage}
      >
        You can continue to your account, or sign out first.
      </HostedAuthMessage>
    );
  }

  if (props.type === "sign-up" && !project.config.signUpEnabled) {
    return (
      <HostedAuthMessage
        title="Sign up disabled"
        primaryAction={() => app.redirectToSignIn()}
        primaryText="Sign in"
        fullPage={props.fullPage}
      >
        New account registration is not enabled for this project.
      </HostedAuthMessage>
    );
  }

  const hasOAuthProviders = project.config.oauthProviders.length > 0;
  const hasPasskey = project.config.passkeyEnabled === true && props.type === "sign-in";
  const hasEmailMethods = project.config.credentialEnabled || project.config.magicLinkEnabled;
  const enableSeparator = hasEmailMethods && (hasOAuthProviders || hasPasskey);

  return (
    <HostedAuthShell fullPage={props.fullPage} paddedFullPage={false}>
      <HostedAuthHeading title={props.type === "sign-in" ? "Sign in" : "Create account"}>
        {props.type === "sign-in" ? (
          <>
            to continue to <span className="font-medium text-foreground">{project.displayName}</span>
          </>
        ) : (
          <>
            to get started with <span className="font-medium text-foreground">{project.displayName}</span>
          </>
        )}
      </HostedAuthHeading>

      {(hasOAuthProviders || hasPasskey) && (
        <div className="mb-2 flex flex-col items-stretch gap-3">
          {hasOAuthProviders && <OAuthButtonGroup type={props.type} mockProject={props.mockProject} />}
          {hasPasskey && <PasskeyButton type={props.type} />}
        </div>
      )}

      {enableSeparator && <SeparatorWithText text="Or continue with" />}

      {project.config.credentialEnabled && project.config.magicLinkEnabled ? (
        <Tabs defaultValue={props.firstTab || "magic-link"} className="w-full">
          <TabsList className={cn(authTabsListClassName, {
            "flex-row-reverse": props.firstTab === "password",
          })}>
            <TabsTrigger value="magic-link" className={authTabsTriggerClassName}>Email</TabsTrigger>
            <TabsTrigger value="password" className={authTabsTriggerClassName}>Email & Password</TabsTrigger>
          </TabsList>
          <TabsContent value="magic-link" className="focus-visible:outline-none focus-visible:ring-0">
            <MagicLinkSignIn />
          </TabsContent>
          <TabsContent value="password" className="focus-visible:outline-none focus-visible:ring-0">
            {props.type === "sign-up" ? <CredentialSignUp noPasswordRepeat={props.noPasswordRepeat} /> : <CredentialSignIn />}
          </TabsContent>
        </Tabs>
      ) : project.config.credentialEnabled ? (
        props.type === "sign-up" ? <CredentialSignUp noPasswordRepeat={props.noPasswordRepeat} /> : <CredentialSignIn />
      ) : project.config.magicLinkEnabled ? (
        <MagicLinkSignIn />
      ) : !(hasOAuthProviders || hasPasskey) ? (
        <p className="py-4 text-center text-sm text-destructive">No authentication method enabled.</p>
      ) : null}

      <div className={authFooterClassName}>
        {props.type === "sign-in" ? (
          project.config.signUpEnabled && (
            <p className="text-muted-foreground">
              Don't have an account?{" "}
              <a
                href={app.urls.signUp}
                className={authFooterLinkClassName}
                onClick={(event) => {
                  event.preventDefault();
                  runAsynchronously(app.redirectToSignUp());
                }}
              >
                Sign up
              </a>
            </p>
          )
        ) : (
          <p className="text-muted-foreground">
            Already have an account?{" "}
            <a
              href={app.urls.signIn}
              className={authFooterLinkClassName}
              onClick={(event) => {
                event.preventDefault();
                runAsynchronously(app.redirectToSignIn());
              }}
            >
              Sign in
            </a>
          </p>
        )}
      </div>

      {props.extraInfo != null && (
        <div className="mt-4 flex flex-col items-center border-t border-black/[0.06] pt-3 text-center text-xs text-muted-foreground dark:border-white/[0.06]">
          <div>{props.extraInfo}</div>
        </div>
      )}
    </HostedAuthShell>
  );
}

function HostedAuthPage(props: Parameters<typeof HostedAuthPageInner>[0]) {
  return (
    <Suspense fallback={<HostedAuthFallback fullPage={props.fullPage} />}>
      <HostedAuthPageInner {...props} />
    </Suspense>
  );
}

export function HostedSignIn(props: {
  fullPage?: boolean,
  automaticRedirect?: boolean,
  extraInfo?: React.ReactNode,
  firstTab?: "magic-link" | "password",
  mockProject?: AuthProject,
}) {
  return (
    <HostedAuthPage
      fullPage={!!props.fullPage}
      type="sign-in"
      automaticRedirect={!!props.automaticRedirect}
      extraInfo={props.extraInfo}
      firstTab={props.firstTab}
      mockProject={props.mockProject}
    />
  );
}

export function HostedSignUp(props: {
  fullPage?: boolean,
  automaticRedirect?: boolean,
  noPasswordRepeat?: boolean,
  extraInfo?: React.ReactNode,
  firstTab?: "magic-link" | "password",
}) {
  return (
    <HostedAuthPage
      fullPage={!!props.fullPage}
      type="sign-up"
      automaticRedirect={!!props.automaticRedirect}
      noPasswordRepeat={props.noPasswordRepeat}
      extraInfo={props.extraInfo}
      firstTab={props.firstTab}
    />
  );
}

export function HostedForgotPassword(props: {
  fullPage?: boolean,
}) {
  const app = useStackApp();
  const user = useUser();
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState<string | null>(null);
  const [sentEmail, setSentEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit() {
    setEmailError(null);
    if (!isValidEmail(email)) {
      setEmailError("Please enter a valid email");
      return;
    }

    setLoading(true);
    try {
      await app.sendForgotPasswordEmail(email);
      setSentEmail(email);
    } finally {
      setLoading(false);
    }
  }

  if (user != null) {
    return (
      <HostedAuthMessage
        title="You're already signed in"
        primaryAction={() => app.redirectToHome()}
        primaryText="Go home"
        secondaryAction={() => app.redirectToSignOut()}
        secondaryText="Sign out"
        fullPage={props.fullPage}
      >
        You can continue to your account, or sign out before resetting another account's password.
      </HostedAuthMessage>
    );
  }

  if (sentEmail != null) {
    return (
      <HostedAuthMessage
        title="Check your email"
        primaryAction={() => app.redirectToSignIn()}
        primaryText="Back to sign in"
        secondaryAction={() => setSentEmail(null)}
        secondaryText="Use a different email"
        fullPage={props.fullPage}
      >
        If an account exists for this email, we sent password reset instructions to your inbox.
      </HostedAuthMessage>
    );
  }

  return (
    <HostedAuthShell fullPage={props.fullPage}>
      <HostedAuthHeading title="Reset password">
        Enter your email and we'll send reset instructions.
      </HostedAuthHeading>

      <form
        className="stack-scope flex flex-col items-stretch"
        onSubmit={(event) => {
          event.preventDefault();
          runAsynchronouslyWithAlert(submit());
        }}
        noValidate
      >
        <Label htmlFor="email" className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Email</Label>
        <Input
          id="email"
          type="email"
          autoComplete="email"
          className="h-10 rounded-xl border-border bg-background"
          value={email}
          onChange={(event) => {
            setEmail(event.target.value);
            setEmailError(null);
          }}
        />
        <FormWarningText text={emailError} />

        <Button type="submit" className="mt-6 h-10 rounded-xl font-semibold shadow-sm hover:shadow" loading={loading}>
          Send reset email
        </Button>
      </form>

      <div className={authFooterClassName}>
        <p className="text-muted-foreground">
          Remembered your password?{" "}
          <a
            href={app.urls.signIn}
            className={authFooterLinkClassName}
            onClick={(event) => {
              event.preventDefault();
              runAsynchronously(app.redirectToSignIn());
            }}
          >
            Sign in
          </a>
        </p>
      </div>
    </HostedAuthShell>
  );
}

export function HostedPasswordReset(props: {
  fullPage?: boolean,
}) {
  const app = useStackApp();
  const searchParams = getSearchParams();
  const code = searchParams.code;
  const [verificationState, setVerificationState] = useState<"checking" | "valid" | "invalid" | "expired" | "used">(code == null ? "invalid" : "checking");
  const [password, setPassword] = useState("");
  const [passwordRepeat, setPasswordRepeat] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordRepeatError, setPasswordRepeatError] = useState<string | null>(null);
  const [finished, setFinished] = useState(false);
  const [resetError, setResetError] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (code == null) {
      return;
    }

    runAsynchronouslyWithAlert((async () => {
      const result = await app.verifyPasswordResetCode(code);
      if (result.status === "ok") {
        setVerificationState("valid");
      } else if (KnownErrors.VerificationCodeExpired.isInstance(result.error)) {
        setVerificationState("expired");
      } else if (KnownErrors.VerificationCodeAlreadyUsed.isInstance(result.error)) {
        setVerificationState("used");
      } else {
        setVerificationState("invalid");
      }
    })());
  }, [app, code]);

  async function submit() {
    if (code == null) {
      setResetError(true);
      return;
    }

    setPasswordError(null);
    setPasswordRepeatError(null);
    if (password.length === 0) {
      setPasswordError("Please enter your password");
      return;
    }
    const passwordValidationError = getPasswordError(password);
    if (passwordValidationError != null) {
      setPasswordError(passwordValidationError.message);
      return;
    }
    if (passwordRepeat !== password) {
      setPasswordRepeatError("Passwords do not match");
      return;
    }

    setLoading(true);
    try {
      const result = await app.resetPassword({ password, code });
      if (result.status === "error") {
        setResetError(true);
        return;
      }
      setFinished(true);
    } finally {
      setLoading(false);
    }
  }

  if (verificationState === "checking") {
    return <HostedAuthFallback fullPage={props.fullPage} />;
  }

  if (verificationState === "invalid") {
    return (
      <HostedAuthMessage
        title="Invalid reset link"
        primaryAction={() => app.redirectToForgotPassword()}
        primaryText="Request a new link"
        secondaryAction={() => app.redirectToSignIn({ noRedirectBack: true })}
        secondaryText="Back to sign in"
        fullPage={props.fullPage}
      >
        This password reset link is invalid. Please request a new link from the forgot password page.
      </HostedAuthMessage>
    );
  }

  if (verificationState === "expired") {
    return (
      <HostedAuthMessage
        title="Reset link expired"
        primaryAction={() => app.redirectToForgotPassword()}
        primaryText="Request a new link"
        secondaryAction={() => app.redirectToSignIn({ noRedirectBack: true })}
        secondaryText="Back to sign in"
        fullPage={props.fullPage}
      >
        This password reset link has expired. Please request a new link and try again.
      </HostedAuthMessage>
    );
  }

  if (verificationState === "used") {
    return (
      <HostedAuthMessage
        title="Reset link already used"
        primaryAction={() => app.redirectToForgotPassword()}
        primaryText="Request a new link"
        secondaryAction={() => app.redirectToSignIn({ noRedirectBack: true })}
        secondaryText="Back to sign in"
        fullPage={props.fullPage}
      >
        This password reset link has already been used. Request a new link if you still need to reset your password.
      </HostedAuthMessage>
    );
  }

  if (finished) {
    return (
      <HostedAuthMessage
        title="Password reset"
        primaryAction={() => app.redirectToSignIn({ noRedirectBack: true })}
        primaryText="Sign in"
        fullPage={props.fullPage}
      >
        Your password has been reset. You can now sign in with your new password.
      </HostedAuthMessage>
    );
  }

  if (resetError) {
    return (
      <HostedAuthMessage
        title="Failed to reset password"
        primaryAction={() => app.redirectToForgotPassword()}
        primaryText="Request a new link"
        secondaryAction={() => app.redirectToSignIn({ noRedirectBack: true })}
        secondaryText="Back to sign in"
        fullPage={props.fullPage}
      >
        This reset link could not be used. Please request a new password reset link and try again.
      </HostedAuthMessage>
    );
  }

  return (
    <HostedAuthShell fullPage={props.fullPage}>
      <HostedAuthHeading title="Reset password">
        Choose a new password for your account.
      </HostedAuthHeading>

      <form
        className="stack-scope flex flex-col items-stretch"
        onSubmit={(event) => {
          event.preventDefault();
          runAsynchronouslyWithAlert(submit());
        }}
        noValidate
      >
        <Label htmlFor="password" className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">New password</Label>
        <PasswordInput
          id="password"
          autoComplete="new-password"
          className="h-10 rounded-xl border-border bg-background"
          value={password}
          onChange={(event) => {
            setPassword(event.target.value);
            setPasswordError(null);
            setPasswordRepeatError(null);
          }}
        />
        <FormWarningText text={passwordError} />

        <Label htmlFor="repeat-password" className="mb-1.5 mt-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Repeat new password</Label>
        <PasswordInput
          id="repeat-password"
          autoComplete="new-password"
          className="h-10 rounded-xl border-border bg-background"
          value={passwordRepeat}
          onChange={(event) => {
            setPasswordRepeat(event.target.value);
            setPasswordError(null);
            setPasswordRepeatError(null);
          }}
        />
        <FormWarningText text={passwordRepeatError} />

        <Button type="submit" className="mt-6 h-10 rounded-xl font-semibold shadow-sm hover:shadow" loading={loading}>
          Reset password
        </Button>
      </form>

      <div className={authFooterClassName}>
        <p className="text-muted-foreground">
          Remembered your password?{" "}
          <a
            href={app.urls.signIn}
            className={authFooterLinkClassName}
            onClick={(event) => {
              event.preventDefault();
              runAsynchronously(app.redirectToSignIn({ noRedirectBack: true }));
            }}
          >
            Sign in
          </a>
        </p>
      </div>
    </HostedAuthShell>
  );
}

export function HostedEmailVerification(props: {
  fullPage?: boolean,
}) {
  const app = useStackApp();
  const searchParams = getSearchParams();
  const code = searchParams.code;
  const [result, setResult] = useState<Awaited<ReturnType<typeof app.verifyEmail>> | null>(null);

  const invalid = (
    <HostedAuthMessage
      title="Invalid verification link"
      primaryAction={() => app.redirectToHome()}
      primaryText="Go home"
      fullPage={props.fullPage}
    >
      This verification link is invalid. Please check the link or request a new verification email.
    </HostedAuthMessage>
  );

  if (code == null) {
    return invalid;
  }

  if (result == null) {
    return (
      <HostedAuthMessage
        title="Verify your email"
        primaryText="Verify email"
        primaryAction={async () => {
          setResult(await app.verifyEmail(code));
        }}
        secondaryText="Cancel"
        secondaryAction={() => app.redirectToHome()}
        fullPage={props.fullPage}
      >
        Confirm that you want to verify this email address for your account.
      </HostedAuthMessage>
    );
  }

  if (result.status === "error") {
    if (KnownErrors.VerificationCodeExpired.isInstance(result.error)) {
      return (
        <HostedAuthMessage
          title="Verification link expired"
          primaryAction={() => app.redirectToHome()}
          primaryText="Go home"
          fullPage={props.fullPage}
        >
          This verification link has expired. Please request a new verification email from your account settings.
        </HostedAuthMessage>
      );
    }
    if (KnownErrors.VerificationCodeAlreadyUsed.isInstance(result.error)) {
      return (
        <HostedAuthMessage
          title="Email already verified"
          primaryAction={() => app.redirectToHome()}
          primaryText="Go home"
          fullPage={props.fullPage}
        >
          This verification link has already been used, so your email is already verified.
        </HostedAuthMessage>
      );
    }
    if (KnownErrors.VerificationCodeNotFound.isInstance(result.error)) {
      return invalid;
    }
    throw result.error;
  }

  return (
    <HostedAuthMessage
      title="Email verified"
      primaryAction={() => app.redirectToHome()}
      primaryText="Go home"
      fullPage={props.fullPage}
    >
      Your email has been verified. You can continue using your account.
    </HostedAuthMessage>
  );
}

export function HostedMfa(props: {
  fullPage?: boolean,
  onSuccess?: () => void,
  onCancel?: () => void,
}) {
  const app = useStackApp();
  const [otp, setOtp] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [verified, setVerified] = useState(false);
  const [attemptCode, setAttemptCode] = useState<string | null>(null);

  useEffect(() => {
    if (!attemptCode && typeof window !== "undefined") {
      const code = window.sessionStorage.getItem("hexclave_mfa_attempt_code") ?? window.sessionStorage.getItem("stack_mfa_attempt_code");
      if (code) {
        setAttemptCode(code);
      }
    }
  }, [attemptCode]);

  const submit = async (currentOtp: string) => {
    if (!attemptCode || currentOtp.length !== 6 || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await app.signInWithMfa(currentOtp, attemptCode, { noRedirect: true });
      if (result.status === "ok") {
        if (typeof window !== "undefined") {
          window.sessionStorage.removeItem("hexclave_mfa_attempt_code");
          window.sessionStorage.removeItem("stack_mfa_attempt_code");
        }
        setVerified(true);
        if (props.onSuccess) {
          props.onSuccess();
        } else {
          await app.redirectToAfterSignIn();
        }
      } else if (KnownErrors.InvalidTotpCode.isInstance(result.error)) {
        setError("Invalid TOTP code");
        setOtp("");
      } else {
        setError("Verification failed");
      }
    } catch (e) {
      setError("Verification failed");
    } finally {
      setSubmitting(false);
    }
  };

  const inputStyleClass = useMemo(() => {
    if (verified) {
      return "opacity-85 transition-all duration-300";
    }
    if (error) {
      return "ring-red-500 border-red-500 dark:ring-red-500 dark:border-red-500";
    }
    return "focus:ring-primary/50";
  }, [error, verified]);

  return (
    <HostedAuthShell fullPage={props.fullPage}>
      <div className="text-center mb-6">
        <Typography type="h2">Multi-Factor Authentication</Typography>
        <Typography className="mt-2 text-sm text-muted-foreground">
          Enter the six-digit code from your authenticator app
        </Typography>
      </div>

      <div className="flex flex-col items-center gap-4 stack-scope">
        <form
          className="w-full flex flex-col items-center gap-4"
          onSubmit={(e) => e.preventDefault()}
        >
          <InputOTP
            maxLength={6}
            type="text"
            inputMode="numeric"
            placeholder="······"
            value={otp}
            onChange={(value) => {
              const val = value.toUpperCase();
              setOtp(val);
              if (val.length === 6) {
                runAsynchronously(submit(val));
              } else {
                setError(null);
              }
            }}
            disabled={submitting || verified}
          >
            <InputOTPGroup>
              {[0, 1, 2, 3, 4, 5].map((index) => (
                <InputOTPSlot
                  key={index}
                  index={index}
                  size="lg"
                  className={cn(
                    "border focus:ring-2 transition-all",
                    inputStyleClass,
                  )}
                />
              ))}
            </InputOTPGroup>
          </InputOTP>

          <div className="h-8 flex flex-col items-center justify-center w-full">
            {verified ? (
              <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-500 animate-in fade-in duration-300 slide-in-from-bottom-2">
                <Check className="w-5 h-5 animate-in zoom-in duration-300" />
                <Typography className="text-sm font-medium">Verified! Redirecting...</Typography>
              </div>
            ) : submitting ? (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Spinner className="h-4 w-4" />
                <Typography className="text-sm">Verifying...</Typography>
              </div>
            ) : null}

            {error !== null && !submitting && !verified ? (
              <FormWarningText text={error} />
            ) : null}
          </div>
        </form>
      </div>

      {props.onCancel && !verified && (
        <Button
          variant="link"
          onClick={props.onCancel}
          className="underline mt-4 self-center"
          disabled={submitting || verified}
        >
          Cancel
        </Button>
      )}
    </HostedAuthShell>
  );
}

export function HostedError(props: {
  fullPage?: boolean,
}) {
  const app = useStackApp();
  const searchParams = getSearchParams();
  const errorCode = searchParams.errorCode;
  const message = searchParams.message;
  const details = searchParams.details;

  const unknownErrorCard = (
    <HostedAuthMessage
      title="An unknown error occurred"
      primaryAction={() => app.redirectToHome()}
      primaryText="Go home"
      fullPage={props.fullPage}
    >
      Something went wrong. Please try again or contact support.
    </HostedAuthMessage>
  );

  if (!errorCode || !message) {
    return unknownErrorCard;
  }

  let error: KnownError;
  try {
    const detailJson = details ? JSON.parse(details) : {};
    error = KnownError.fromJson({ code: errorCode, message, details: detailJson });
  } catch (e) {
    return unknownErrorCard;
  }

  if (KnownErrors.OAuthConnectionAlreadyConnectedToAnotherUser.isInstance(error)) {
    return (
      <HostedAuthMessage
        title="Failed to connect account"
        primaryAction={() => app.redirectToHome()}
        primaryText="Go home"
        fullPage={props.fullPage}
      >
        This account is already connected to another user. Please connect a different account.
      </HostedAuthMessage>
    );
  }

  if (KnownErrors.UserAlreadyConnectedToAnotherOAuthConnection.isInstance(error)) {
    return (
      <HostedAuthMessage
        title="Failed to connect account"
        primaryAction={() => app.redirectToHome()}
        primaryText="Go home"
        fullPage={props.fullPage}
      >
        The user is already connected to another OAuth account. Did you maybe select the wrong account on the OAuth provider page?
      </HostedAuthMessage>
    );
  }

  if (KnownErrors.OAuthProviderAccessDenied.isInstance(error)) {
    return (
      <HostedAuthMessage
        title="OAuth provider access denied"
        primaryAction={() => app.redirectToSignIn()}
        primaryText="Sign in again"
        secondaryAction={() => app.redirectToHome()}
        secondaryText="Go home"
        fullPage={props.fullPage}
      >
        The sign-in operation has been cancelled or denied. Please try again.
      </HostedAuthMessage>
    );
  }

  if (KnownErrors.OAuthProviderTemporarilyUnavailable.isInstance(error)) {
    return (
      <HostedAuthMessage
        title="OAuth provider is temporarily unavailable"
        primaryAction={() => app.redirectToSignIn()}
        primaryText="Try again"
        secondaryAction={() => app.redirectToHome()}
        secondaryText="Go home"
        fullPage={props.fullPage}
      >
        The OAuth provider could not complete sign-in right now. Please try again in a moment.
      </HostedAuthMessage>
    );
  }

  return (
    <HostedAuthMessage
      title="An error occurred"
      primaryAction={() => app.redirectToHome()}
      primaryText="Go home"
      fullPage={props.fullPage}
    >
      <div className="flex flex-col gap-1 text-center">
        <Typography className="text-sm text-muted-foreground">Error Code: {error.errorCode}</Typography>
        <Typography className="text-sm text-muted-foreground">Error Message: {error.message}</Typography>
      </div>
    </HostedAuthMessage>
  );
}

export function HostedTeamInvitation(props: {
  fullPage?: boolean,
}) {
  const app = useStackApp();
  const user = useUser({ includeRestricted: true });
  const searchParams = getSearchParams();
  const code = searchParams.code;

  const [accepted, setAccepted] = useState(false);
  const [details, setDetails] = useState<null | { teamDisplayName: string }>(null);
  const [pageError, setPageError] = useState<null | "invalid" | "expired" | "used" | "unknown">(null);
  const [verifying, setVerifying] = useState(false);
  const [joining, setJoining] = useState(false);

  const invalidJsx = (
    <HostedAuthMessage
      title="Invalid Invitation Link"
      primaryAction={() => app.redirectToHome()}
      primaryText="Go home"
      fullPage={props.fullPage}
    >
      Please double check if you have the correct team invitation link.
    </HostedAuthMessage>
  );

  const expiredJsx = (
    <HostedAuthMessage
      title="Expired Invitation Link"
      primaryAction={() => app.redirectToHome()}
      primaryText="Go home"
      fullPage={props.fullPage}
    >
      Your team invitation link has expired. Please request a new team invitation link.
    </HostedAuthMessage>
  );

  const usedJsx = (
    <HostedAuthMessage
      title="Used Invitation Link"
      primaryAction={() => app.redirectToHome()}
      primaryText="Go home"
      fullPage={props.fullPage}
    >
      This team invitation link has already been used.
    </HostedAuthMessage>
  );

  const unknownJsx = (
    <HostedAuthMessage
      title="Something went wrong"
      primaryAction={() => app.redirectToHome()}
      primaryText="Go home"
      fullPage={props.fullPage}
    >
      An unexpected error occurred. Please try again later.
    </HostedAuthMessage>
  );

  if (!code) {
    return invalidJsx;
  }

  if (!user) {
    return (
      <HostedAuthMessage
        title="Team Invitation"
        primaryAction={() => app.redirectToSignIn()}
        primaryText="Sign in"
        secondaryAction={() => app.redirectToHome()}
        secondaryText="Cancel"
        fullPage={props.fullPage}
      >
        Sign in or create an account to join the team.
      </HostedAuthMessage>
    );
  }

  if (user.isRestricted) {
    return (
      <HostedAuthMessage
        title="Complete your account setup"
        primaryAction={() => app.redirectToOnboarding()}
        primaryText="Complete setup"
        secondaryAction={() => app.redirectToHome()}
        secondaryText="Cancel"
        fullPage={props.fullPage}
      >
        Please complete your account setup before joining teams.
      </HostedAuthMessage>
    );
  }

  if (pageError === "invalid") return invalidJsx;
  if (pageError === "expired") return expiredJsx;
  if (pageError === "used") return usedJsx;
  if (pageError === "unknown") return unknownJsx;

  if (verifying) {
    return <HostedAuthLoading fullPage={props.fullPage} />;
  }

  if (!details) {
    return (
      <HostedAuthMessage
        title="Team Invitation"
        primaryAction={async () => {
          setVerifying(true);
          setPageError(null);
          try {
            if (code === "demo-code") {
              await new Promise((resolve) => setTimeout(resolve, 600));
              setDetails({ teamDisplayName: "Acme Corp" });
              return;
            }

            const verification = await app.verifyTeamInvitationCode(code);
            if (verification.status === "error") {
              if (KnownErrors.VerificationCodeNotFound.isInstance(verification.error)) {
                setPageError("invalid");
                return;
              }
              if (KnownErrors.VerificationCodeExpired.isInstance(verification.error)) {
                setPageError("expired");
                return;
              }
              if (KnownErrors.VerificationCodeAlreadyUsed.isInstance(verification.error)) {
                setPageError("used");
                return;
              }
              throw verification.error;
            }

            const invitationDetails = await app.getTeamInvitationDetails(code);
            if (invitationDetails.status === "error") {
              setPageError("unknown");
              return;
            }

            setDetails(invitationDetails.data);
          } catch (e) {
            setPageError("unknown");
          } finally {
            setVerifying(false);
          }
        }}
        primaryText="Check invitation"
        secondaryAction={() => app.redirectToHome()}
        secondaryText="Cancel"
        fullPage={props.fullPage}
      >
        We will verify your invitation before showing the join action.
      </HostedAuthMessage>
    );
  }

  if (accepted) {
    return (
      <HostedAuthMessage
        title="Joined Team!"
        primaryAction={() => app.redirectToHome()}
        primaryText="Go home"
        fullPage={props.fullPage}
      >
        You have successfully joined <span className="font-semibold text-foreground">{details.teamDisplayName}</span>.
      </HostedAuthMessage>
    );
  }

  return (
    <HostedAuthMessage
      title="Team Invitation"
      primaryAction={async () => {
        setJoining(true);
        try {
          if (code === "demo-code") {
            await new Promise((resolve) => setTimeout(resolve, 600));
            setAccepted(true);
            return;
          }

          const result = await app.acceptTeamInvitation(code);
          if (result.status === "ok") {
            setAccepted(true);
          } else {
            setPageError("unknown");
          }
        } catch (e) {
          setPageError("unknown");
        } finally {
          setJoining(false);
        }
      }}
      primaryText={joining ? "Joining..." : "Join"}
      secondaryAction={() => app.redirectToHome()}
      secondaryText="Ignore"
      fullPage={props.fullPage}
    >
      You are invited to join <span className="font-semibold text-foreground">{details.teamDisplayName}</span>.
    </HostedAuthMessage>
  );
}

export function HostedCliAuthConfirm(props: {
  fullPage?: boolean,
}) {
  const app = useStackApp();
  const cliAuth = useCliAuthConfirmation();

  if (cliAuth.status === "success") {
    return (
      <HostedAuthMessage
        title="CLI Authorized Successfully"
        primaryAction={() => app.redirectToHome()}
        primaryText="Go home"
        fullPage={props.fullPage}
      >
        The CLI application has been authorized successfully. You can close this window and return to the command line.
      </HostedAuthMessage>
    );
  }

  if (cliAuth.status === "error") {
    return (
      <HostedAuthMessage
        title="Authorization Failed"
        primaryAction={cliAuth.retry}
        primaryText="Try again"
        secondaryAction={() => app.redirectToHome()}
        secondaryText="Cancel"
        fullPage={props.fullPage}
      >
        <div className="flex flex-col gap-1 text-center">
          <Typography className="text-sm text-destructive">
            Failed to authorize the CLI application:
          </Typography>
          <Typography className="text-xs text-muted-foreground font-mono bg-muted p-2 rounded-lg break-all">
            {cliAuth.error?.message || "An unknown error occurred."}
          </Typography>
        </div>
      </HostedAuthMessage>
    );
  }

  if (cliAuth.status === "invalid") {
    return (
      <HostedAuthMessage
        title="Invalid Authorization Link"
        primaryAction={() => app.redirectToHome()}
        primaryText="Go home"
        fullPage={props.fullPage}
      >
        This CLI authorization link is missing a login code. Please return to the command line and start the login process again.
      </HostedAuthMessage>
    );
  }

  if (cliAuth.status === "authorizing" || cliAuth.status === "redirecting") {
    return <HostedAuthLoading fullPage={props.fullPage} />;
  }

  return (
    <HostedAuthShell fullPage={props.fullPage}>
      <div className="text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
          <KeyRound className="h-6 w-6" />
        </div>
        <Typography type="h2" className="mb-2 text-xl font-semibold tracking-tight">
          Authorize CLI Application
        </Typography>
        <Typography className="text-sm text-muted-foreground">
          A command line application is requesting access to your account. Clicking authorize will grant a secure access token to the CLI.
        </Typography>
      </div>

      <div className="mt-6 rounded-xl border border-destructive/20 bg-destructive/5 p-4 text-left">
        <Typography className="text-xs font-semibold text-destructive mb-1 uppercase tracking-wider">
          Security Warning
        </Typography>
        <Typography className="text-xs text-muted-foreground leading-relaxed">
          Make sure you trust the command line application, as it will gain access to your account. If you did not initiate this request, please close this page and ignore it.
        </Typography>
      </div>

      <div className="mt-6 flex flex-col gap-2.5">
        <Button
          onClick={cliAuth.authorize}
          disabled={cliAuth.isLoading}
          className="h-10 rounded-xl font-semibold shadow-sm hover:shadow"
        >
          {cliAuth.isLoading ? "Authorizing..." : "Authorize"}
        </Button>
        <Button
          variant="secondary"
          onClick={() => app.redirectToHome()}
          disabled={cliAuth.isLoading}
          className="h-10 rounded-xl font-semibold"
        >
          Cancel
        </Button>
      </div>
    </HostedAuthShell>
  );
}

export function HostedOnboarding(props: {
  fullPage?: boolean,
}) {
  const realApp = useStackApp();
  const realUser = useUser({ includeRestricted: true });
  const searchParams = getSearchParams();
  const demoMode = searchParams.demo;

  const [demoEmail, setDemoEmail] = useState("");
  const [demoChangeEmail, setDemoChangeEmail] = useState(false);

  const app = useMemo(() => {
    if (!demoMode) return realApp;
    return {
      redirectToAfterSignIn: async () => {
        alert("Redirecting to after sign-in page...");
      },
      redirectToSignIn: async () => {
        alert("Redirecting to sign-in page...");
      },
    } as any;
  }, [demoMode, realApp]);

  const user = useMemo(() => {
    if (!demoMode) return realUser;
    if (demoMode === "anonymous") return null;

    const baseMockUser = {
      isAnonymous: false,
      signOut: async () => {
        alert("Signing out...");
      },
      update: async (data: { primaryEmail?: string }) => {
        alert(`Updating primary email to: ${data.primaryEmail}`);
        setDemoEmail(data.primaryEmail || "");
        setDemoChangeEmail(false);
      },
      sendVerificationEmail: async () => {
        alert("Verification email sent!");
      },
    };

    if (demoMode === "add-email") {
      return {
        ...baseMockUser,
        isRestricted: true,
        primaryEmail: demoEmail || null,
        restrictedReason: { type: "email_not_verified" },
      } as any;
    }

    if (demoMode === "verify-email") {
      return {
        ...baseMockUser,
        isRestricted: true,
        primaryEmail: demoEmail || "user@example.com",
        restrictedReason: { type: "email_not_verified" },
      } as any;
    }

    if (demoMode === "other-restricted") {
      return {
        ...baseMockUser,
        isRestricted: true,
        primaryEmail: "user@example.com",
        restrictedReason: { type: "other_reason" },
      } as any;
    }

    if (demoMode === "unrestricted") {
      return {
        ...baseMockUser,
        isRestricted: false,
        primaryEmail: "user@example.com",
      } as any;
    }

    return null;
  }, [demoMode, realUser, demoEmail]);

  const [emailInput, setEmailInput] = useState("");
  const [changeEmail, setChangeEmail] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resending, setResending] = useState(false);
  const [resent, setResent] = useState(false);

  // Sync email input when user primaryEmail changes or when changeEmail is toggled
  useEffect(() => {
    if (user?.primaryEmail) {
      setEmailInput(user.primaryEmail);
    } else {
      setEmailInput("");
    }
  }, [user?.primaryEmail, changeEmail]);

  // If user is not restricted, redirect to after-sign-in page
  if (user && !user.isRestricted) {
    if (!demoMode) {
      runAsynchronously(app.redirectToAfterSignIn());
    }
    return <HostedAuthLoading fullPage={props.fullPage} />;
  }

  // If no user or anonymous, redirect to sign-in
  if (!user || user.isAnonymous) {
    if (!demoMode) {
      runAsynchronously(app.redirectToSignIn());
    }
    return <HostedAuthLoading fullPage={props.fullPage} />;
  }

  const restrictedReason = user.restrictedReason;

  // Sign out handler
  const handleSignOut = async () => {
    setLoading(true);
    try {
      await user.signOut();
    } catch (e: any) {
      setError(e.message || "Failed to sign out.");
    } finally {
      setLoading(false);
    }
  };

  // Handle email_not_verified
  if (restrictedReason?.type === "email_not_verified") {
    const hasPrimaryEmail = !!user.primaryEmail;
    const isEditingEmail = !hasPrimaryEmail || changeEmail || demoChangeEmail;

    if (isEditingEmail) {
      const handleAddEmail = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!emailInput.trim()) {
          setError("Email address is required.");
          return;
        }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailInput)) {
          setError("Please enter a valid email address.");
          return;
        }

        setLoading(true);
        setError(null);
        try {
          await user.update({ primaryEmail: emailInput });
          setChangeEmail(false);
          if (demoMode) {
            setDemoChangeEmail(false);
          }
        } catch (err: any) {
          setError(err.message || "Failed to update email address.");
        } finally {
          setLoading(false);
        }
      };

      return (
        <HostedAuthShell fullPage={props.fullPage}>
          <div className="text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Mail className="h-6 w-6" />
            </div>
            <Typography type="h2" className="mb-2 text-xl font-semibold tracking-tight">
              Add your email address
            </Typography>
            <Typography className="text-sm text-muted-foreground">
              Please add an email address to complete your account setup. We will send you a verification email.
            </Typography>
          </div>

          <form onSubmit={(e) => { runAsynchronously(handleAddEmail(e)); }} className="mt-6 flex flex-col gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="email" className="text-sm font-medium">
                Email address
              </Label>
              <Input
                id="email"
                type="email"
                placeholder="name@example.com"
                value={emailInput}
                onChange={(e) => {
                  setEmailInput(e.target.value);
                  setError(null);
                }}
                disabled={loading}
                className="h-10 rounded-xl"
              />
              {error && (
                <Typography className="text-xs text-destructive mt-1">
                  {error}
                </Typography>
              )}
            </div>

            <div className="flex flex-col gap-2.5">
              <Button
                type="submit"
                disabled={loading}
                className="h-10 rounded-xl font-semibold shadow-sm hover:shadow"
              >
                {loading ? <Spinner size={16} className="mr-2" /> : null}
                Continue
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={handleSignOut}
                disabled={loading}
                className="h-10 rounded-xl font-semibold"
              >
                Sign out
              </Button>
            </div>
          </form>
        </HostedAuthShell>
      );
    }

    // User has email but it's not verified
    const handleResendEmail = async () => {
      setResending(true);
      setError(null);
      setResent(false);
      try {
        await user.sendVerificationEmail();
        setResent(true);
      } catch (err: any) {
        setError(err.message || "Failed to send verification email.");
      } finally {
        setResending(false);
      }
    };

    return (
      <HostedAuthShell fullPage={props.fullPage}>
        <div className="text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Mail className="h-6 w-6" />
          </div>
          <Typography type="h2" className="mb-2 text-xl font-semibold tracking-tight">
            Please check your email inbox
          </Typography>
          <Typography className="text-sm text-muted-foreground">
            We sent a verification link to{" "}
            <span className="font-semibold text-foreground break-all">{user.primaryEmail}</span>.
            Please verify your email address to complete your account setup.
          </Typography>
        </div>

        {resent && (
          <div className="mt-4 flex items-center gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3 text-emerald-600 dark:text-emerald-400">
            <Check className="h-4 w-4 shrink-0" />
            <Typography className="text-xs font-medium">
              Verification email resent successfully!
            </Typography>
          </div>
        )}

        {error && (
          <div className="mt-4 flex items-center gap-2 rounded-xl border border-destructive/20 bg-destructive/5 p-3 text-destructive">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <Typography className="text-xs font-medium">
              {error}
            </Typography>
          </div>
        )}

        <div className="mt-6 flex flex-col gap-2.5">
          <Button
            onClick={handleResendEmail}
            disabled={resending}
            className="h-10 rounded-xl font-semibold shadow-sm hover:shadow"
          >
            {resending ? <Spinner size={16} className="mr-2" /> : null}
            Resend verification email
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              setChangeEmail(true);
              if (demoMode) {
                setDemoChangeEmail(true);
              }
              setError(null);
              setResent(false);
            }}
            disabled={resending}
            className="h-10 rounded-xl font-semibold"
          >
            Change email address
          </Button>
          <Button
            variant="ghost"
            onClick={handleSignOut}
            disabled={resending}
            className="h-10 rounded-xl font-semibold text-muted-foreground hover:text-foreground"
          >
            Sign out
          </Button>
        </div>
      </HostedAuthShell>
    );
  }

  // Generic setup-required state
  return (
    <HostedAuthShell fullPage={props.fullPage}>
      <div className="text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
          <AlertTriangle className="h-6 w-6" />
        </div>
        <Typography type="h2" className="mb-2 text-xl font-semibold tracking-tight">
          Complete your account setup
        </Typography>
        <Typography className="text-sm text-muted-foreground">
          You have not yet completed your account setup. Please reach out to support if you believe this is an error.
        </Typography>
      </div>

      {error && (
        <div className="mt-4 flex items-center gap-2 rounded-xl border border-destructive/20 bg-destructive/5 p-3 text-destructive">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <Typography className="text-xs font-medium">
            {error}
          </Typography>
        </div>
      )}

      <div className="mt-6 flex flex-col gap-2.5">
        <Button
          variant="secondary"
          onClick={handleSignOut}
          disabled={loading}
          className="h-10 rounded-xl font-semibold"
        >
          {loading ? <Spinner size={16} className="mr-2" /> : null}
          Sign out
        </Button>
      </div>
    </HostedAuthShell>
  );
}


