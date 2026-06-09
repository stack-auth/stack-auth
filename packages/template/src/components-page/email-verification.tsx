'use client';

import { KnownErrors } from "@hexclave/shared";
import { throwErr } from "@hexclave/shared/dist/utils/errors";
import { Button, Typography, cn } from "@hexclave/ui";
import type { ReactNode } from "react";
import { useState } from "react";
import { useStackApp } from "..";
import { MaybeFullPage } from "../components/elements/maybe-full-page";
import { useTranslation } from "../lib/translations";

function EmailVerificationShell({
  children,
  fullPage,
}: {
  children: ReactNode,
  fullPage?: boolean,
}) {
  const content = (
    <div
      className={cn(
        "stack-scope flex w-full max-w-[400px] flex-col items-stretch text-foreground",
        fullPage ? "p-4 sm:p-6" : "p-0"
      )}
    >
      {children}
    </div>
  );

  if (!fullPage) return content;

  return (
    <MaybeFullPage fullPage={true}>
      <div className="relative flex min-h-screen w-full items-center justify-center overflow-hidden bg-background p-4 sm:p-6">
        {content}
      </div>
    </MaybeFullPage>
  );
}

function EmailVerificationMessage({
  title,
  children,
  primaryAction,
  primaryText,
  secondaryAction,
  secondaryText,
  fullPage,
}: {
  title: string,
  children: ReactNode,
  primaryAction: () => Promise<void> | void,
  primaryText: string,
  secondaryAction?: () => Promise<void> | void,
  secondaryText?: string,
  fullPage?: boolean,
}) {
  return (
    <EmailVerificationShell fullPage={fullPage}>
      <div className="text-center">
        <Typography type='h2' className="mb-2 text-xl font-semibold tracking-tight">{title}</Typography>
        <Typography className="text-sm text-muted-foreground">{children}</Typography>
      </div>
      <div className="mt-6 flex flex-col gap-2.5">
        <Button onClick={primaryAction} className="h-10 rounded-xl font-semibold shadow-sm hover:shadow transition-all duration-150">
          {primaryText}
        </Button>
        {secondaryAction && secondaryText && (
          <Button variant="secondary" onClick={secondaryAction} className="h-10 rounded-xl font-semibold">
            {secondaryText}
          </Button>
        )}
      </div>
    </EmailVerificationShell>
  );
}

export function EmailVerification(props: {
  searchParams?: Record<string, string>,
  fullPage?: boolean,
}) {
  const { t } = useTranslation();
  const hexclaveApp = useStackApp();
  const [result, setResult] = useState<Awaited<ReturnType<typeof hexclaveApp.verifyEmail>> | null>(null);

  const invalidJsx = (
    <EmailVerificationMessage
      title={t("Invalid verification link")}
      primaryAction={() => hexclaveApp.redirectToHome()}
      primaryText={t("Go home")}
      fullPage={props.fullPage}
    >
      {t("This verification link is invalid. Please check the link or request a new verification email.")}
    </EmailVerificationMessage>
  );

  const expiredJsx = (
    <EmailVerificationMessage
      title={t("Verification link expired")}
      primaryAction={() => hexclaveApp.redirectToHome()}
      primaryText={t("Go home")}
      fullPage={props.fullPage}
    >
      {t("This verification link has expired. Please request a new verification email from your account settings.")}
    </EmailVerificationMessage>
  );

  const verifiedJsx = (
    <EmailVerificationMessage
      title={t("Email verified")}
      primaryAction={() => hexclaveApp.redirectToHome()}
      primaryText={t("Go home")}
      fullPage={props.fullPage}
    >
      {t("Your email has been verified. You can continue using your account.")}
    </EmailVerificationMessage>
  );

  const alreadyVerifiedJsx = (
    <EmailVerificationMessage
      title={t("Email already verified")}
      primaryAction={() => hexclaveApp.redirectToHome()}
      primaryText={t("Go home")}
      fullPage={props.fullPage}
    >
      {t("This verification link has already been used, so your email is already verified.")}
    </EmailVerificationMessage>
  );

  if (!props.searchParams?.code) {
    return invalidJsx;
  }

  if (!result) {
    return (
      <EmailVerificationMessage
        title={t("Verify your email")}
        primaryText={t("Verify email")}
        primaryAction={async () => {
          const result = await hexclaveApp.verifyEmail(props.searchParams?.code || throwErr("No verification code provided"));
          setResult(result);
        }}
        secondaryText={t("Cancel")}
        secondaryAction={() => hexclaveApp.redirectToHome()}
        fullPage={props.fullPage}
      >
        {t("Confirm that you want to verify this email address for your account.")}
      </EmailVerificationMessage>
    );
  }

  if (result.status === 'error') {
    if (KnownErrors.VerificationCodeNotFound.isInstance(result.error)) {
      return invalidJsx;
    } else if (KnownErrors.VerificationCodeExpired.isInstance(result.error)) {
      return expiredJsx;
    } else if (KnownErrors.VerificationCodeAlreadyUsed.isInstance(result.error)) {
      return alreadyVerifiedJsx;
    } else {
      throw result.error;
    }
  }

  return verifiedJsx;
}
