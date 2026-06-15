import { useStackApp, useUser } from "@hexclave/react";
import { runAsynchronously } from "@hexclave/shared/dist/utils/promises";
import { AlertTriangle, Check, Mail } from "lucide-react";
import React, { useEffect, useMemo, useRef, useState } from "react";

import { Button, Input, Label, Spinner, Typography } from "~/components/ui";

import { HostedAuthLoading, HostedAuthShell } from "./supporting/layout";
import { getSearchParams } from "./supporting/utils";

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
  const lastRedirectTargetRef = useRef<"after-sign-in" | "sign-in" | null>(null);

  // Sync email input when user primaryEmail changes or when changeEmail is toggled
  useEffect(() => {
    if (user?.primaryEmail) {
      setEmailInput(user.primaryEmail);
    } else {
      setEmailInput("");
    }
  }, [user?.primaryEmail, changeEmail]);

  const redirectTarget = !demoMode
    ? user != null && !user.isRestricted
      ? "after-sign-in"
      : user == null || user.isAnonymous
        ? "sign-in"
        : null
    : null;

  useEffect(() => {
    if (redirectTarget == null || lastRedirectTargetRef.current === redirectTarget) {
      return;
    }

    lastRedirectTargetRef.current = redirectTarget;
    runAsynchronously(
      redirectTarget === "after-sign-in"
        ? app.redirectToAfterSignIn()
        : app.redirectToSignIn(),
    );
  }, [app, redirectTarget]);

  // If user is not restricted, redirect to after-sign-in page
  if (user && !user.isRestricted) {
    return <HostedAuthLoading fullPage={props.fullPage} />;
  }

  // If no user or anonymous, redirect to sign-in
  if (!user || user.isAnonymous) {
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
