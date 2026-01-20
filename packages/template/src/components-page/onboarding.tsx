'use client';

import { yupResolver } from "@hookform/resolvers/yup";
import { strictEmailSchema, yupObject } from "@stackframe/stack-shared/dist/schema-fields";
import { runAsynchronously, runAsynchronouslyWithAlert } from "@stackframe/stack-shared/dist/utils/promises";
import { Button, Input, Typography } from "@stackframe/stack-ui";
import { useState } from "react";
import { useForm } from "react-hook-form";
import * as yup from "yup";
import { useStackApp, useUser } from "..";
import { FormWarningText } from "../components/elements/form-warning";
import { MessageCard } from "../components/message-cards/message-card";
import { useTranslation } from "../lib/translations";

export function Onboarding(props: {
  fullPage?: boolean,
}) {
  const { t } = useTranslation();
  const stackApp = useStackApp();
  const user = useUser({ or: "return-null", includeRestricted: true });

  // If user is not restricted anymore, redirect to the intended destination
  // redirectToAfterSignIn automatically checks for after_auth_return_to in the URL
  if (user && !user.isRestricted) {
    runAsynchronously(stackApp.redirectToAfterSignIn());
    // TODO: This should return a loading indicator, not just null
    return null;
  }

  // If user is anonymous or not logged in, redirect to sign-in
  if (!user || user.isAnonymous) {
    runAsynchronously(stackApp.redirectToSignIn());
    // TODO: This should return a loading indicator, not just null
    return null;
  }

  // User is restricted - show appropriate onboarding step based on restricted reason
  const restrictedReason = user.restrictedReason;

  if (restrictedReason?.type === "email_not_verified") {
    // Check if user has a primary email
    const hasPrimaryEmail = !!user.primaryEmail;

    if (!hasPrimaryEmail) {
      // User needs to add an email first
      return <AddEmailForm fullPage={props.fullPage} />;
    }

    // User has email but it's not verified
    return <VerifyEmailScreen user={user} email={user.primaryEmail} fullPage={props.fullPage} />;
  }

  // Unknown restricted reason - show generic message
  return (
    <MessageCard
      title={t("Complete your account setup")}
      fullPage={!!props.fullPage}
      secondaryButtonText={t("Sign out")}
      secondaryAction={async () => {
        await user.signOut();
      }}
    >
      <p>{t("Please complete your account setup to continue.")}</p>
    </MessageCard>
  );
}

function AddEmailForm(props: {
  fullPage?: boolean,
  onEmailAdded?: () => void,
}) {
  const { t } = useTranslation();
  const user = useUser({ or: "throw", includeRestricted: true });
  const stackApp = useStackApp();
  const [loading, setLoading] = useState(false);

  const emailSchema = yupObject({
    email: strictEmailSchema(t('Please enter a valid email address'))
      .defined()
      .nonEmpty(t('Email is required')),
  });

  const { register, handleSubmit, formState: { errors } } = useForm({
    resolver: yupResolver(emailSchema)
  });

  const onSubmit = async (data: yup.InferType<typeof emailSchema>) => {
    setLoading(true);
    try {
      await user.update({ primaryEmail: data.email });
      props.onEmailAdded?.();
    } finally {
      setLoading(false);
    }
  };

  return (
    <MessageCard
      title={t("Add your email address")}
      fullPage={!!props.fullPage}
      secondaryButtonText={t("Sign out")}
      secondaryAction={async () => {
        await user.signOut();
      }}
    >
      <Typography className="mb-4">
        {t("Please add an email address to complete your account setup. We'll send you a verification email.")}
      </Typography>
      <form
        onSubmit={e => runAsynchronouslyWithAlert(handleSubmit(onSubmit)(e))}
        noValidate
        className='flex flex-col gap-2'
      >
        <Input
          {...register("email")}
          placeholder={t("Enter your email")}
          type="email"
        />
        {errors.email && <FormWarningText text={errors.email.message} />}
        <Button type="submit" loading={loading} className="w-full">
          {t("Continue")}
        </Button>
      </form>
    </MessageCard>
  );
}

function VerifyEmailScreen(props: {
  user: NonNullable<ReturnType<typeof useUser>>,
  email: string,
  fullPage?: boolean,
}) {
  const { t } = useTranslation();
  const { user, email } = props;
  const [changingEmail, setChangingEmail] = useState(false);

  if (changingEmail) {
    return <AddEmailForm fullPage={props.fullPage} onEmailAdded={() => setChangingEmail(false)} />;
  }

  return (
    <MessageCard
      title={t("Please check your email inbox")}
      fullPage={!!props.fullPage}
      primaryButtonText={t("Resend verification email")}
      primaryAction={async () => {
        await user.sendVerificationEmail();
      }}
      secondaryButtonText={t("Sign out")}
      secondaryAction={async () => {
        await user.signOut();
      }}
    >
      <Typography>
        {t("Please verify your email address ")}
        <span className="font-semibold">{email}</span>
        {" ("}
        <button
          type="button"
          className="text-primary hover:underline"
          onClick={() => setChangingEmail(true)}
        >
          {t("change")}
        </button>
        {"). "}
        {t("Click the button below to resend the verification link.")}
      </Typography>
    </MessageCard>
  );
}

