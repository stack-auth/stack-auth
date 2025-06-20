import { Button, Typography } from "@stackframe/stack-ui";
import { useState } from "react";
import { useStackApp, useUser } from "../../../lib/hooks";
import { useTranslation } from "../../../lib/translations";
import { Section } from "../section";

export function OtpSection(props?: {
  mockMode?: boolean,
}) {
  const { t } = useTranslation();
  const user = useUser({ or: props?.mockMode ? 'return-null' : "throw" });

  // In mock mode, show a placeholder message
  if (props?.mockMode && !user) {
    return (
      <Section
        title={t("One-Time Password")}
        description={t("OTP management is not available in demo mode.")}
      >
        <Typography variant='secondary'>{t("OTP management is not available in demo mode.")}</Typography>
      </Section>
    );
  }

  if (!user) {
    return null; // This shouldn't happen in non-mock mode due to throw
  }
  const project = useStackApp().useProject();
  const contactChannels = user.useContactChannels();
  const isLastAuth = user.otpAuthEnabled && !user.hasPassword && user.oauthProviders.length === 0 && !user.passkeyAuthEnabled;
  const [disabling, setDisabling] = useState(false);

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  const hasValidEmail = contactChannels.filter(x => x.type === 'email' && x.isVerified && x.usedForAuth).length > 0;

  if (!project.config.magicLinkEnabled) {
    return null;
  }

  const handleDisableOTP = async () => {
    await user.update({ otpAuthEnabled: false });
    setDisabling(false);
  };

  return (
    <Section title={t("OTP sign-in")} description={user.otpAuthEnabled ? t("OTP/magic link sign-in is currently enabled.") : t("Enable sign-in via magic link or OTP sent to your sign-in emails.")}>
      <div className='flex md:justify-end'>
        {hasValidEmail ? (
          user.otpAuthEnabled ? (
            !isLastAuth ? (
              !disabling ? (
                <Button
                  variant='secondary'
                  onClick={() => setDisabling(true)}
                >
                  {t("Disable OTP")}
                </Button>
              ) : (
                <div className='flex flex-col gap-2'>
                  <Typography variant='destructive'>
                    {t("Are you sure you want to disable OTP sign-in? You will not be able to sign in with only emails anymore.")}
                  </Typography>
                  <div className='flex gap-2'>
                    <Button
                      variant='destructive'
                      onClick={handleDisableOTP}
                    >
                      {t("Disable")}
                    </Button>
                    <Button
                      variant='secondary'
                      onClick={() => setDisabling(false)}
                    >
                      {t("Cancel")}
                    </Button>
                  </div>
                </div>
              )
            ) : (
              <Typography variant='secondary' type='label'>{t("OTP sign-in is enabled and cannot be disabled as it is currently the only sign-in method")}</Typography>
            )
          ) : (
            <Button
              variant='secondary'
              onClick={async () => {
                await user.update({ otpAuthEnabled: true });
              }}
            >
              {t("Enable OTP")}
            </Button>
          )
        ) : (
          <Typography variant='secondary' type='label'>{t("To enable OTP sign-in, please add a verified sign-in email.")}</Typography>
        )}
      </div>
    </Section>
  );
}
