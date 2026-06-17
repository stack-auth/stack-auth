import { Button } from "~/components/ui";

import { useState } from "react";
import { useStackApp, useUser } from "@hexclave/react";
import {
  getButtonRadiusClassName,
  getOutlineButtonClassName,
  useDesign,
} from "../design-context";
import { Section } from "../section";
import { cn } from "~/components/ui";

export function OtpSection(props?: {
  mockMode?: boolean,
}) {
  const isInMockMode = !!props?.mockMode;
  const user = useUser({ or: isInMockMode ? 'return-null' : 'redirect' });
  const project = useStackApp().useProject();

  // In mock mode, show a placeholder message
  if (isInMockMode && !user) {
    return (
      <Section
        title="One-Time Password"
        description="OTP management is not available in demo mode."
      >
        <span className="text-sm text-muted-foreground">OTP management is not available in demo mode.</span>
      </Section>
    );
  }

  if (!user) {
    return null;
  }

  if (!project.config.magicLinkEnabled) {
    return null;
  }

  return <OtpSectionInner user={user} />;
}

function OtpSectionInner({ user }: { user: any }) {
  const design = useDesign();
  const contactChannels = user.useContactChannels();
  const isLastAuth = user.otpAuthEnabled && !user.hasPassword && user.oauthProviders.length === 0 && !user.passkeyAuthEnabled;
  const [disabling, setDisabling] = useState(false);

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  const hasValidEmail = contactChannels.filter((x: any) => (x.type as string) === 'email' && x.isVerified && x.usedForAuth).length > 0;

  const handleDisableOTP = async () => {
    try {
      await user.update({ otpAuthEnabled: false });
    } finally {
      setDisabling(false);
    }
  };

  return (
    <Section title="OTP sign-in" description={user.otpAuthEnabled ? "OTP/magic link sign-in is currently enabled." : "Enable sign-in via magic link or OTP sent to your sign-in emails."}>
      <div className='flex flex-col md:items-end gap-2 w-full md:w-[350px]'>
        {hasValidEmail ? (
          user.otpAuthEnabled ? (
            !isLastAuth ? (
              !disabling ? (
                <Button
                  variant='outline'
                  onClick={() => setDisabling(true)}
                  className={getOutlineButtonClassName(design, "px-4 py-2 w-full transition-colors duration-150")}
                >
                  Disable OTP
                </Button>
              ) : (
                <div className='flex flex-col gap-3 w-full'>
                  <span className='text-xs font-semibold text-red-500 leading-relaxed text-left md:text-right'>
                    Are you sure you want to disable OTP sign-in? You will not be able to sign in with only emails anymore.
                  </span>
                  <div className='flex gap-2 w-full'>
                    <Button
                      variant='destructive'
                      onClick={handleDisableOTP}
                      className={cn(getButtonRadiusClassName(design), "flex-1 text-xs")}
                    >
                      Disable
                    </Button>
                    <Button
                      variant='outline'
                      onClick={() => setDisabling(false)}
                      className={getOutlineButtonClassName(design, "flex-1 text-xs")}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              )
            ) : (
              <span className="text-xs text-muted-foreground/85 leading-relaxed text-left md:text-right">
                OTP sign-in is enabled and cannot be disabled as it is currently the only sign-in method.
              </span>
            )
          ) : (
            <Button
              variant='outline'
              onClick={async () => {
                await user.update({ otpAuthEnabled: true });
              }}
              className={getOutlineButtonClassName(design, "px-4 py-2 w-full transition-colors duration-150")}
            >
              Enable OTP
            </Button>
          )
        ) : (
          <span className="text-xs text-muted-foreground/85 leading-relaxed text-left md:text-right">
            To enable OTP sign-in, please add a verified sign-in email.
          </span>
        )}
      </div>
    </Section>
  );
}
