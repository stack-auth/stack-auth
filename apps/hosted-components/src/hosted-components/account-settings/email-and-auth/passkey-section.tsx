import { Button, cn } from "~/components/ui";

import { useState } from "react";
import { useStackApp, useUser } from "@hexclave/react";
import {
  getButtonRadiusClassName,
  getOutlineButtonClassName,
  useDesign,
} from "../design-context";
import { Section } from "../section";

export function PasskeySection(props?: {
  mockMode?: boolean,
}) {
  const isInMockMode = !!props?.mockMode;
  const user = useUser({ or: isInMockMode ? 'return-null' : "redirect" });
  const stackApp = useStackApp();
  const project = stackApp.useProject();

  // In mock mode, show a placeholder message
  if (isInMockMode && !user) {
    return (
      <Section
        title="Passkey"
        description="Passkey management is not available in demo mode."
      >
        <span className="text-sm text-muted-foreground">Passkey management is not available in demo mode.</span>
      </Section>
    );
  }

  if (!user) {
    return null;
  }

  if (!project.config.passkeyEnabled) {
    return null;
  }

  return <PasskeySectionInner user={user} />;
}

function PasskeySectionInner({ user }: { user: any }) {
  const design = useDesign();
  const contactChannels = user.useContactChannels();

  // passkey is enabled if there is a passkey
  const hasPasskey = user.passkeyAuthEnabled;

  const isLastAuth = user.passkeyAuthEnabled && !user.hasPassword && user.oauthProviders.length === 0 && !user.otpAuthEnabled;
  const [showConfirmationModal, setShowConfirmationModal] = useState(false);

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  const hasValidEmail = contactChannels.filter((x: any) => (x.type as string) === 'email' && x.isVerified && x.usedForAuth).length > 0;

  const handleDeletePasskey = async () => {
    await user.update({ passkeyAuthEnabled: false });
    setShowConfirmationModal(false);
  };

  const handleAddNewPasskey = async () => {
    await user.registerPasskey();
  };

  return (
    <Section title="Passkey" description={hasPasskey ? "Passkey registered" : "Register a passkey"}>
      <div className='flex flex-col md:items-end gap-2 w-full md:w-[350px]'>
        {!hasValidEmail && (
          <span className="text-xs text-muted-foreground/85 leading-relaxed text-left md:text-right">
            To enable Passkey sign-in, please add a verified sign-in email.
          </span>
        )}
        {hasValidEmail && hasPasskey && isLastAuth && (
          <span className="text-xs text-muted-foreground/85 leading-relaxed text-left md:text-right">
            Passkey sign-in is enabled and cannot be disabled as it is currently the only sign-in method.
          </span>
        )}
        {!hasPasskey && hasValidEmail && (
          <Button
            onClick={handleAddNewPasskey}
            variant='outline'
            className={getOutlineButtonClassName(design, "px-4 py-2 w-full transition-colors duration-150")}
          >
            Add new passkey
          </Button>
        )}
        {hasValidEmail && hasPasskey && !isLastAuth && !showConfirmationModal && (
          <Button
            variant='outline'
            onClick={() => setShowConfirmationModal(true)}
            className={getOutlineButtonClassName(design, "px-4 py-2 w-full text-red-500 hover:text-red-600 transition-colors duration-150")}
          >
            Delete Passkey
          </Button>
        )}
        {hasValidEmail && hasPasskey && !isLastAuth && showConfirmationModal && (
          <div className='flex flex-col gap-3 w-full'>
            <span className='text-xs font-semibold text-red-500 leading-relaxed text-left md:text-right'>
              Are you sure you want to disable Passkey sign-in? You will not be able to sign in with your passkey anymore.
            </span>
            <div className='flex gap-2 w-full'>
              <Button
                variant='destructive'
                onClick={handleDeletePasskey}
                className={cn(getButtonRadiusClassName(design), "flex-1 text-xs")}
              >
                Disable
              </Button>
              <Button
                variant='outline'
                onClick={() => setShowConfirmationModal(false)}
                className={getOutlineButtonClassName(design, "flex-1 text-xs")}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
      </div>
    </Section>
  );
}
