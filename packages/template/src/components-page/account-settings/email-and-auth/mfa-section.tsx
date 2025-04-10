import { createTOTPKeyURI, verifyTOTP } from "@oslojs/otp";
import { useAsyncCallback } from '@stackframe/stack-shared/dist/hooks/use-async-callback';
import { generateRandomValues } from '@stackframe/stack-shared/dist/utils/crypto';
import { throwErr } from "@stackframe/stack-shared/dist/utils/errors";
import { runAsynchronouslyWithAlert } from "@stackframe/stack-shared/dist/utils/promises";
import { Button, Input, Typography } from "@stackframe/stack-ui";
import * as QRCode from 'qrcode';
import { useEffect, useState } from "react";
import { CurrentUser, Project } from '../../..';
import { useStackApp, useUser } from "../../../lib/hooks";
import { useTranslation } from "../../../lib/translations";
import { Section } from "../section";

export function MfaSection() {
  const { t } = useTranslation();
  const project = useStackApp().useProject();
  const user = useUser({ or: "throw" });
  const [generatedSecret, setGeneratedSecret] = useState<Uint8Array | null>(null);
  const [qrCodeUrl, setQrCodeUrl] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState<string>("");
  const [isMaybeWrong, setIsMaybeWrong] = useState(false);
  const isEnabled = user.isMultiFactorRequired;

  const [handleSubmit, isLoading] = useAsyncCallback(async () => {
    await user.update({
      totpMultiFactorSecret: generatedSecret,
    });
    setGeneratedSecret(null);
    setQrCodeUrl(null);
    setMfaCode("");
  }, [generatedSecret, user]);

  useEffect(() => {
    setIsMaybeWrong(false);
    runAsynchronouslyWithAlert(async () => {
      if (generatedSecret && verifyTOTP(generatedSecret, 30, 6, mfaCode)) {
        await handleSubmit();
      }
      setIsMaybeWrong(true);
    });
  }, [mfaCode, generatedSecret, handleSubmit]);

  return (
    <Section
      title={t("Multi-factor authentication")}
      description={isEnabled
        ? t("Multi-factor authentication is currently enabled.")
        : t("Multi-factor authentication is currently disabled.")}
    >
      <div className='flex flex-col gap-4'>
        {!isEnabled && generatedSecret && (
          <>
            <Typography>{t("Scan this QR code with your authenticator app:")}</Typography>
            <img width={200} height={200} src={qrCodeUrl ?? throwErr("TOTP QR code failed to generate")} alt={t("TOTP multi-factor authentication QR code")} />
            <Typography>{t("Then, enter your six-digit MFA code:")}</Typography>
            <Input
              value={mfaCode}
              onChange={(e) => {
                setIsMaybeWrong(false);
                setMfaCode(e.target.value);
              }}
              placeholder="123456"
              maxLength={6}
              disabled={isLoading}
            />
            {isMaybeWrong && mfaCode.length === 6 && (
              <Typography variant="destructive">{t("Incorrect code. Please try again.")}</Typography>
            )}
            <div className='flex'>
              <Button
                variant='secondary'
                onClick={() => {
                  setGeneratedSecret(null);
                  setQrCodeUrl(null);
                  setMfaCode("");
                }}
              >
                {t("Cancel")}
              </Button>
            </div>
          </>
        )}
        <div className='flex gap-2'>
          {isEnabled ? (
            <Button
              variant='secondary'
              onClick={async () => {
                await user.update({
                  totpMultiFactorSecret: null,
                });
              }}
            >
              {t("Disable MFA")}
            </Button>
          ) : !generatedSecret && (
            <Button
              variant='secondary'
              onClick={async () => {
                const secret = generateRandomValues(new Uint8Array(20));
                setQrCodeUrl(await generateTotpQrCode(project, user, secret));
                setGeneratedSecret(secret);
              }}
            >
              {t("Enable MFA")}
            </Button>
          )}
        </div>
      </div>
    </Section>
  );
}


async function generateTotpQrCode(project: Project, user: CurrentUser, secret: Uint8Array) {
  const uri = createTOTPKeyURI(project.displayName, user.primaryEmail ?? user.id, secret, 30, 6);
  return await QRCode.toDataURL(uri) as any;
}
