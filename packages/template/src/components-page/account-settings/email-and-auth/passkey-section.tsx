import { Button, Typography } from "@stackframe/stack-ui";
import { useState } from "react";
import { useStackApp } from "../../..";
import { useUser } from "../../../lib/hooks";
import { useTranslation } from "../../../lib/translations";
import { Section } from "../section";

export function PasskeySection(props?: {
  mockMode?: boolean,
}) {
  const { t } = useTranslation();
  const user = useUser({ or: props?.mockMode ? 'return-null' : "throw" });

  // In mock mode, show a placeholder message
  if (props?.mockMode && !user) {
    return (
      <Section
        title={t("Passkey")}
        description={t("Passkey management is not available in demo mode.")}
      >
        <Typography variant='secondary'>{t("Passkey management is not available in demo mode.")}</Typography>
      </Section>
    );
  }

  if (!user) {
    return null; // This shouldn't happen in non-mock mode due to throw
  }
  const stackApp = useStackApp();
  const project = stackApp.useProject();
  const contactChannels = user.useContactChannels();


  // passkey is enabled if there is a passkey
  const hasPasskey = user.passkeyAuthEnabled;

  const isLastAuth = user.passkeyAuthEnabled && !user.hasPassword && user.oauthProviders.length === 0 && !user.otpAuthEnabled;
  const [showConfirmationModal, setShowConfirmationModal] = useState(false);

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  const hasValidEmail = contactChannels.filter(x => x.type === 'email' && x.isVerified && x.usedForAuth).length > 0;

  if (!project.config.passkeyEnabled) {
    return null;
  }

  const handleDeletePasskey = async () => {
    await user.update({ passkeyAuthEnabled: false });
    setShowConfirmationModal(false);
  };


  const handleAddNewPasskey = async () => {
    await user.registerPasskey();
  };

  return (
    <>
      <Section title={t("Passkey")} description={hasPasskey ? t("Passkey registered") : t("Register a passkey")}>
        <div className='flex md:justify-end gap-2'>
          {!hasValidEmail && (
            <Typography variant='secondary' type='label'>{t("To enable Passkey sign-in, please add a verified sign-in email.")}</Typography>
          )}
          {hasValidEmail && hasPasskey && isLastAuth && (
            <Typography variant='secondary' type='label'>{t("Passkey sign-in is enabled and cannot be disabled as it is currently the only sign-in method")}</Typography>
          )}
          {!hasPasskey && hasValidEmail && (
            <div>
              <Button onClick={handleAddNewPasskey} variant='secondary'>{t("Add new passkey")}</Button>
            </div>
          )}
          {hasValidEmail && hasPasskey && !isLastAuth && !showConfirmationModal && (
            <Button
              variant='secondary'
              onClick={() => setShowConfirmationModal(true)}
            >
              {t("Delete Passkey")}
            </Button>
          )}
          {hasValidEmail && hasPasskey && !isLastAuth && showConfirmationModal && (
            <div className='flex flex-col gap-2'>
              <Typography variant='destructive'>
                {t("Are you sure you want to disable Passkey sign-in? You will not be able to sign in with your passkey anymore.")}
              </Typography>
              <div className='flex gap-2'>
                <Button
                  variant='destructive'
                  onClick={handleDeletePasskey}
                >
                  {t("Disable")}
                </Button>
                <Button
                  variant='secondary'
                  onClick={() => setShowConfirmationModal(false)}
                >
                  {t("Cancel")}
                </Button>
              </div>
            </div>
          )}
        </div>
      </Section>


    </>

  );
}
