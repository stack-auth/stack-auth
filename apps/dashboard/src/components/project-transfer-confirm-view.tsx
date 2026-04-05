"use client";

import { DesignAlert } from "@/components/design-components/alert";
import { DesignButton } from "@/components/design-components/button";
import { DesignCard } from "@/components/design-components/card";
import { DesignInput } from "@/components/design-components/input";
import { Logo } from "@/components/logo";
import { Spinner } from "@/components/ui";
import { ArrowsLeftRightIcon } from "@phosphor-icons/react";

export type ProjectTransferConfirmUiState = "loading" | "success" | { type: "error", message: string };

export type ProjectTransferConfirmViewProps = {
  state: ProjectTransferConfirmUiState,
  /** When `state === "success"`, whether the “signed in” branch is shown. */
  signedIn: boolean,
  /** Label for the disabled “Receiving account” field when signed in. */
  signedInAsLabel?: string,
  onCancel?: () => void | Promise<void>,
  onPrimary?: () => void | Promise<void>,
  onSwitchAccount?: () => void | Promise<void>,
};

/** Presentational shell for the custom integration project transfer confirmation screen. */
export function ProjectTransferConfirmView(props: ProjectTransferConfirmViewProps) {
  const {
    state,
    signedIn,
    signedInAsLabel = "Signed in as preview@example.com",
    onCancel,
    onPrimary,
    onSwitchAccount,
  } = props;

  const primaryLabel = signedIn ? "Accept transfer" : "Sign in";

  return (
    <div className="flex min-h-[100dvh] w-full items-center justify-center px-4 py-8 sm:px-6">
      <DesignCard
        className="w-full max-w-lg"
        title="Project transfer"
        icon={ArrowsLeftRightIcon}
        subtitle="This integration wants to move a Stack Auth project into your dashboard account so you can manage users, keys, and settings directly in Stack Auth."
        gradient="blue"
        contentClassName="space-y-5"
        actions={(
          <div className="flex flex-shrink-0 items-center gap-2 sm:gap-3">
            <Logo noLink alt="Stack Auth" width={48} height={48} />
          </div>
        )}
      >
        {state === "loading" && (
          <div className="flex flex-col items-center gap-3 py-4 sm:flex-row sm:justify-center sm:py-6">
            <Spinner size={22} className="text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Verifying this transfer link…</p>
          </div>
        )}

        {state === "success" && (
          <div className="space-y-4">
            {signedIn ? (
              <>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  You&apos;ll still be able to open this project from the third party&apos;s dashboard after you accept.
                </p>
                <div className="space-y-2">
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Receiving account
                  </span>
                  <DesignInput
                    type="text"
                    disabled
                    size="md"
                    prefixItem={<Logo noLink width={15} height={15} alt="" />}
                    value={signedInAsLabel}
                  />
                </div>
                <DesignButton
                  variant="outline"
                  className="w-full sm:w-auto transition-colors duration-150 hover:transition-none"
                  onClick={async () => {
                    await onSwitchAccount?.();
                  }}
                >
                  Use a different account
                </DesignButton>
              </>
            ) : (
              <DesignAlert
                variant="info"
                title="Sign in to continue"
                description="Transferring a project requires an active Stack Auth account. You can sign in or create one on the next step; we&apos;ll bring you back here automatically."
                glassmorphic
              />
            )}
          </div>
        )}

        {typeof state !== "string" && (
          <DesignAlert
            variant="error"
            title="This transfer can’t continue"
            description={state.message}
            glassmorphic
          />
        )}

        {state === "success" && (
          <div className="flex flex-col-reverse gap-2 border-t border-black/[0.08] pt-5 dark:border-white/[0.08] sm:flex-row sm:justify-end">
            <DesignButton
              variant="outline"
              className="transition-colors duration-150 hover:transition-none sm:min-w-[6.5rem]"
              onClick={async () => {
                await onCancel?.();
              }}
            >
              Cancel
            </DesignButton>
            <DesignButton
              className="sm:min-w-[6.5rem]"
              onClick={async () => {
                await onPrimary?.();
              }}
            >
              {primaryLabel}
            </DesignButton>
          </div>
        )}
      </DesignCard>
    </div>
  );
}
