'use client';

import { createTOTPKeyURI, verifyTOTP } from "@oslojs/otp";
import { useAsyncCallback } from '@hexclave/shared/dist/hooks/use-async-callback';
import { generateRandomValues } from '@hexclave/shared/dist/utils/crypto';
import { throwErr } from "@hexclave/shared/dist/utils/errors";
import { runAsynchronouslyWithAlert } from "@hexclave/shared/dist/utils/promises";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import * as QRCode from 'qrcode';
import { useEffect, useState } from "react";
import { CurrentUser, Project } from '@hexclave/next';
import { useStackApp, useUser } from "@hexclave/next";
import { Section } from "../section";

export function MfaSection(props?: {
  mockMode?: boolean,
}) {
  const project = useStackApp().useProject();
  const isInMockMode = !!props?.mockMode;
  const user = useUser({ or: isInMockMode ? 'return-null' : 'redirect' });

  // In mock mode, show a placeholder message
  if (isInMockMode && !user) {
    return (
      <Section
        title="Multi-factor authentication"
        description="MFA management is not available in demo mode."
      >
        <span className="text-sm text-muted-foreground">MFA management is not available in demo mode.</span>
      </Section>
    );
  }

  if (!user) {
    return null;
  }

  return <MfaSectionInner user={user} project={project} />;
}

function MfaSectionInner({ user, project }: { user: CurrentUser, project: Project }) {
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
        return;
      }
      setIsMaybeWrong(mfaCode.length === 6);
    });
  }, [mfaCode, generatedSecret, handleSubmit]);

  return (
    <Section
      title="Multi-factor authentication"
      description={isEnabled
        ? "Multi-factor authentication is currently enabled."
        : "Multi-factor authentication is currently disabled."}
    >
      <div className='flex flex-col gap-4 w-full md:w-[350px]'>
        {!isEnabled && generatedSecret && (
          <div className="flex flex-col gap-3">
            <span className="text-sm font-medium text-foreground">Scan this QR code with your authenticator app:</span>
            <div className="flex justify-center mx-auto p-2 bg-white rounded-xl border border-black/[0.08] dark:border-white/[0.08] w-[216px] h-[216px] shadow-sm">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img width={200} height={200} src={qrCodeUrl ?? throwErr("TOTP QR code failed to generate")} alt="TOTP multi-factor authentication QR code" />
            </div>
            <span className="text-sm font-medium text-foreground mt-2">Then, enter your six-digit MFA code:</span>
            <Input
              value={mfaCode}
              onChange={(e) => {
                setIsMaybeWrong(false);
                setMfaCode(e.target.value);
              }}
              placeholder="123456"
              maxLength={6}
              disabled={isLoading}
              className="bg-white dark:bg-zinc-900 border-black/[0.08] dark:border-white/[0.08] rounded-xl px-3 py-2 shadow-sm focus-visible:ring-black/[0.06] dark:focus-visible:ring-white/[0.06] tracking-[0.2em] font-mono text-center text-lg"
            />
            {isMaybeWrong && mfaCode.length === 6 && (
              <span className="text-red-500 text-xs font-medium">Incorrect code. Please try again.</span>
            )}
            <div className='flex'>
              <Button
                variant='outline'
                onClick={() => {
                  setGeneratedSecret(null);
                  setQrCodeUrl(null);
                  setMfaCode("");
                }}
                className="border-black/[0.08] dark:border-white/[0.08] hover:bg-zinc-50 dark:hover:bg-zinc-900 rounded-xl px-4 py-2 w-full transition-colors duration-150"
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
        <div className='flex gap-2 w-full'>
          {isEnabled ? (
            <Button
              variant='outline'
              onClick={async () => {
                await user.update({
                  totpMultiFactorSecret: null,
                });
              }}
              className="border-black/[0.08] dark:border-white/[0.08] hover:bg-zinc-50 dark:hover:bg-zinc-900 rounded-xl px-4 py-2 w-full text-red-500 hover:text-red-600 transition-colors duration-150"
            >
              Disable MFA
            </Button>
          ) : !generatedSecret && (
            <Button
              variant='outline'
              onClick={async () => {
                const secret = generateRandomValues(new Uint8Array(20));
                setQrCodeUrl(await generateTotpQrCode(project, user, secret));
                setGeneratedSecret(secret);
              }}
              className="border-black/[0.08] dark:border-white/[0.08] hover:bg-zinc-50 dark:hover:bg-zinc-900 rounded-xl px-4 py-2 w-full transition-colors duration-150"
            >
              Enable MFA
            </Button>
          )}
        </div>
      </div>
    </Section>
  );
}

async function generateTotpQrCode(project: Project, user: CurrentUser, secret: Uint8Array) {
  const uri = createTOTPKeyURI(project.displayName, user.primaryEmail ?? user.id, secret, 30, 6);
  return await QRCode.toDataURL(uri);
}
