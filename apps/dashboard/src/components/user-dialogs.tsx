import type { StackAdminApp } from "@hexclave/next";
import { ServerUser } from '@hexclave/next';
import { ActionDialog, Alert, Button, CopyField, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Textarea, Typography } from "@/components/ui";
import { generateImpersonateSnippet } from "@hexclave/shared/dist/utils/browser-action-snippets";
import { throwErr } from "@hexclave/shared/dist/utils/errors";
import { runAsynchronouslyWithAlert } from "@hexclave/shared/dist/utils/promises";
import { useEffect, useMemo, useState } from "react";
import { openBrowserActionInNewTab } from "@/lib/browser-actions";
import { getTrustedOriginOptions, normalizeTrustedOrigin } from "@/lib/trusted-origins";
import { Link } from './link';
import { useRouter } from './router';


export function DeleteUserDialog(props: {
  user: ServerUser,
  open: boolean,
  profileHref: string,
  redirectTo?: string,
  onOpenChange: (open: boolean) => void,
  onDeleted?: () => void | Promise<void>,
}) {
  const router = useRouter();
  const userLabel = props.user.displayName?.trim() || props.user.primaryEmail?.trim() || props.user.id;
  return <ActionDialog
    open={props.open}
    onOpenChange={props.onOpenChange}
    title="Delete User"
    danger
    cancelButton
    okButton={{
      label: "Delete User", onClick: async () => {
        await props.user.delete();
        if (props.onDeleted) {
          runAsynchronouslyWithAlert(Promise.resolve().then(() => props.onDeleted?.()));
        }
        if (props.redirectTo) {
          router.push(props.redirectTo);
        }
      }
    }}
    confirmText="I understand that this action cannot be undone."
  >
    <Typography>
      Are you sure you want to delete the user &quot;<Link
        href={props.profileHref}
        className="inline underline underline-offset-2"
        prefetch={false}
        onClick={() => {
          props.onOpenChange(false);
        }}
      >
        {userLabel}
      </Link>&quot;?
    </Typography>
  </ActionDialog>;
}

export function ImpersonateUserDialog(props: {
  user: ServerUser,
  adminApp: StackAdminApp<false>,
  open: boolean,
  onClose: () => void,
}) {
  const config = props.adminApp.useProject().useConfig();
  const { origins, wildcardDomains } = useMemo(
    () => getTrustedOriginOptions(config.domains.trustedDomains),
    [config.domains.trustedDomains],
  );
  const [selectedOrigin, setSelectedOrigin] = useState("");
  const [customOrigin, setCustomOrigin] = useState("");
  const [reason, setReason] = useState("");
  const [fallbackSnippet, setFallbackSnippet] = useState<string | null>(null);
  const canUseCustomOrigin = config.domains.allowLocalhost;

  useEffect(() => {
    setSelectedOrigin(origins[0]?.origin ?? "");
  }, [origins]);

  useEffect(() => {
    if (!props.open) {
      setFallbackSnippet(null);
      setReason("");
    }
  }, [props.open]);

  async function openBrowserAction() {
    const origin = normalizeTrustedOrigin(customOrigin.trim() || selectedOrigin);
    if (origin == null) {
      window.alert("Enter a valid website address, for example https://app.example.com.");
      return "prevent-close";
    }
    const opened = await openBrowserActionInNewTab(props.adminApp, {
      type: "impersonation",
      origin,
      userId: props.user.id,
      sessionExpiresInMillis: 2 * 60 * 60 * 1000,
      reason: reason.trim() === "" ? undefined : reason.trim(),
    });
    if (opened) {
      props.onClose();
    }
  }

  async function createFallbackSnippet() {
    const expiresInMillis = 2 * 60 * 60 * 1000;
    const session = await props.user.createSession({
      expiresInMillis,
      isImpersonation: true,
      reason: reason.trim() === "" ? undefined : reason.trim(),
    });
    const tokens = await session.getTokens();
    setFallbackSnippet(generateImpersonateSnippet(
      props.adminApp.projectId,
      tokens.refreshToken ?? throwErr("Expected refresh token for newly created impersonation session"),
      new Date(Date.now() + expiresInMillis),
    ));
  }

  return (
    <ActionDialog
      open={props.open}
      onOpenChange={(open) => !open && props.onClose()}
      title="Impersonate User"
      description="Open a trusted website with a short-lived impersonation action."
      cancelButton
      okButton={origins.length > 0 || canUseCustomOrigin ? {
        label: "Impersonate",
        onClick: openBrowserAction,
        props: { disabled: selectedOrigin === "" && customOrigin.trim() === "" },
      } : undefined}
    >
      <div className="space-y-4">
        {origins.length === 0 && !canUseCustomOrigin ? (
          <Alert>
            Add a trusted domain before using the browser action. You can still use the console fallback below.
          </Alert>
        ) : (
          <>
            {origins.length > 0 && (
              <>
                <Typography>Select the website where the impersonated session should open.</Typography>
                <Select value={selectedOrigin} onValueChange={setSelectedOrigin}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a trusted website" />
                  </SelectTrigger>
                  <SelectContent>
                    {origins.map((origin) => <SelectItem key={origin.id} value={origin.origin}>{origin.origin}</SelectItem>)}
                  </SelectContent>
                </Select>
              </>
            )}
            {canUseCustomOrigin && (
              <Input
                value={customOrigin}
                onChange={(event) => setCustomOrigin(event.target.value)}
                placeholder="Exact website address, e.g. http://localhost:5173"
              />
            )}
          </>
        )}
        <div className="space-y-2">
          <Typography>Reason (optional)</Typography>
          <Textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Why are you impersonating this user?"
            maxLength={500}
            rows={2}
          />
        </div>
        {fallbackSnippet == null ? (
          <Button variant="secondary" onClick={async () => await createFallbackSnippet()}>
            Copy console snippet instead
          </Button>
        ) : (
          <CopyField type="textarea" monospace height={100} value={fallbackSnippet} isSecret />
        )}
      </div>
    </ActionDialog>
  );
}
