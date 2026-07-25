import { useStackApp, useUser } from "@hexclave/react";
import { runAsynchronously, runAsynchronouslyWithAlert } from "@hexclave/shared/dist/utils/promises";
import React, { Suspense, useEffect, useState } from "react";

import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  cn,
} from "~/components/ui";

import { CredentialSignIn } from "./forms/credential-sign-in";
import { CredentialSignUp } from "./forms/credential-sign-up";
import { MagicLinkSignIn } from "./forms/magic-link-sign-in";
import { SeparatorWithText } from "./supporting/form-elements";
import {
  HostedAuthFallback,
  HostedAuthHeading,
  HostedAuthLoading,
  HostedAuthMessage,
  HostedAuthShell,
  authFooterClassName,
  authFooterLinkClassName,
} from "./supporting/layout";
import { HostedNoAuthMethods } from "./supporting/no-auth-methods";
import { OAuthButtonGroup } from "./supporting/oauth-button";
import { PasskeyButton } from "./supporting/passkey-button";
import type { AuthProject, AuthType } from "./supporting/types";

type AutomaticRedirectResult =
  | { status: "success" }
  | { status: "error" };

const authTabsListClassName = "mb-4 h-10 w-full rounded-lg border border-black/[0.08] bg-zinc-100/70 p-1 dark:border-white/[0.10] dark:bg-zinc-900/45";
const authTabsTriggerClassName = "h-8 flex-1 rounded-md py-0 text-sm font-medium text-muted-foreground transition-colors duration-300 hover:text-foreground/90 data-[state=active]:font-semibold data-[state=active]:text-foreground";

function AutomaticRedirect(props: {
  fullPage?: boolean,
  isRestricted: boolean,
  type: AuthType,
}) {
  const app = useStackApp();
  const [result, setResult] = useState<AutomaticRedirectResult | null>(null);

  useEffect(() => {
    setResult(null);
    runAsynchronouslyWithAlert((async () => {
      try {
        await (
          props.isRestricted
            ? app.redirectToOnboarding({ replace: true })
            : props.type === "sign-in"
              ? app.redirectToAfterSignIn({ replace: true })
              : app.redirectToAfterSignUp({ replace: true })
        );
        setResult({ status: "success" });
      } catch (error) {
        setResult({ status: "error" });
      }
    })());
  }, [app, props.isRestricted, props.type]);

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

  // Lifted so the typed email survives switching between the "Email" (magic link) and
  // "Email & Password" (credential) tabs — the tab content is unmounted when inactive,
  // so keeping the email here (instead of inside each form) both persists and shares it.
  const [email, setEmail] = useState("");

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

  // Note that we check passkeys regardless of `props.type` here (unlike `hasPasskey`); a project with only
  // passkeys enabled can't sign up with them, but it is configured correctly, so the sign-up page should
  // keep pointing at the sign-in page instead of claiming that the project is misconfigured.
  const hasAnyAuthMethod = hasOAuthProviders
    || project.config.passkeyEnabled === true
    || hasEmailMethods;

  if (!hasAnyAuthMethod) {
    return (
      <HostedNoAuthMethods
        fullPage={props.fullPage}
        projectId={app.projectId}
        projectDisplayName={project.displayName}
      />
    );
  }

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
            <MagicLinkSignIn email={email} onEmailChange={setEmail} />
          </TabsContent>
          <TabsContent value="password" className="focus-visible:outline-none focus-visible:ring-0">
            {props.type === "sign-up" ? <CredentialSignUp noPasswordRepeat={props.noPasswordRepeat} email={email} onEmailChange={setEmail} /> : <CredentialSignIn email={email} onEmailChange={setEmail} />}
          </TabsContent>
        </Tabs>
      ) : project.config.credentialEnabled ? (
        props.type === "sign-up" ? <CredentialSignUp noPasswordRepeat={props.noPasswordRepeat} email={email} onEmailChange={setEmail} /> : <CredentialSignIn email={email} onEmailChange={setEmail} />
      ) : project.config.magicLinkEnabled ? (
        <MagicLinkSignIn email={email} onEmailChange={setEmail} />
      ) : !(hasOAuthProviders || hasPasskey) ? (
        // Only reachable on the sign-up page of a passkey-only project: the project is configured
        // correctly, there is just no way to create an account with a passkey alone.
        <p className="py-2 text-center text-sm text-muted-foreground">
          New accounts can't be created with the sign-in methods enabled for this app. Sign in instead.
        </p>
      ) : null}

      <div className={authFooterClassName}>
        {props.type === "sign-in" ? (
          project.config.signUpEnabled && (
            <p className="text-muted-foreground">
              Don't have an account?{" "}
              <a
                href="#"
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
              href="#"
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
