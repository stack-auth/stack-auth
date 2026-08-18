'use client';

import { Typography } from "@hexclave/ui";
import { KeyRound } from "lucide-react";
import { useTranslation } from "../../lib/translations";
import { MaybeFullPage } from "../elements/maybe-full-page";

const configSnippet = `auth: {
  password: { allowSignIn: true },
  otp: { allowSignIn: true },
}`;

/**
 * Shown instead of the sign-in/sign-up form when a project has no auth methods at all (no password, no
 * OTP, no passkey, no OAuth provider). Without this, the page would look broken: there is nothing the end
 * user can do, and the developer gets no hint about what went wrong or how to fix it.
 */
export function NoAuthMethodsMessageCard(props: {
  fullPage?: boolean,
  projectDisplayName?: string,
}) {
  const { t } = useTranslation();

  return (
    <MaybeFullPage fullPage={!!props.fullPage}>
      <div className='stack-scope flex flex-col items-stretch' style={{ maxWidth: '380px', flexBasis: '380px', padding: props.fullPage ? '1rem' : 0 }}>
        <div className="flex flex-col items-center text-center">
          <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-2xl border border-black/[0.08] dark:border-white/[0.10]">
            <KeyRound className="h-5 w-5 text-gray-500" />
          </div>
          <Typography type='h2'>{t("Sign-in is not available")}</Typography>
          <Typography type='label' variant='secondary'>
            {props.projectDisplayName == null
              ? t("This app has no authentication methods enabled, so nobody can sign in yet.")
              : t("{projectDisplayName} has no authentication methods enabled, so nobody can sign in yet.", { projectDisplayName: props.projectDisplayName })}
          </Typography>
        </div>

        <div className="mt-6 rounded-xl border border-black/[0.08] p-4 text-left dark:border-white/[0.10]">
          <Typography type='label'>{t("Are you the developer?")}</Typography>
          <Typography type='label' variant='secondary'>
            {t("Enable at least one sign-in method in your hexclave.config.ts:")}
          </Typography>
          <pre className="mt-2 overflow-x-auto rounded-lg border border-black/[0.06] p-3 font-mono text-xs leading-relaxed dark:border-white/[0.08]">{configSnippet}</pre>
          <Typography type='label' variant='secondary'>
            {t("Or turn one on in the Hexclave dashboard, under Auth Methods.")}
          </Typography>
        </div>
      </div>
    </MaybeFullPage>
  );
}
