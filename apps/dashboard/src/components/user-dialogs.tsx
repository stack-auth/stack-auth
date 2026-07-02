import { ServerUser } from '@hexclave/next';
import { ActionDialog, CopyField, Typography } from "@/components/ui";
import { deindent } from "@hexclave/shared/dist/utils/strings";
import { useRouter } from './router';


export function DeleteUserDialog(props: {
  user: ServerUser,
  open: boolean,
  redirectTo?: string,
  onOpenChange: (open: boolean) => void,
}) {
  const router = useRouter();
  return <ActionDialog
    open={props.open}
    onOpenChange={props.onOpenChange}
    title="Delete User"
    danger
    cancelButton
    okButton={{
      label: "Delete User", onClick: async () => {
        await props.user.delete();
        if (props.redirectTo) {
          router.push(props.redirectTo);
        }
      }
    }}
    confirmText="I understand that this action cannot be undone."
  >
    {`Are you sure you want to delete the user ${props.user.displayName ? '"' + props.user.displayName + '"' : ''} with ID ${props.user.id}?`}
  </ActionDialog>;
}

export function generateImpersonateSnippet(
  projectId: string,
  refreshToken: string,
  expiresAtDate: Date,
): string {
  // Dynamically expire EVERY refresh cookie for this project before setting ours.
  // The SDK selects the refresh token by scanning all cookies whose name starts
  // with `hexclave-refresh-{pid}--` / `stack-refresh-{pid}--` (with or without the
  // __Host- prefix) and keeping the one with the newest `updated_at_millis`. A
  // hardcoded list of names misses structured variants like the cross-subdomain
  // `--custom-*` cookies, so a stale/future-dated one could still win the selection
  // and keep impersonation from taking effect. We instead iterate document.cookie
  // and delete any name matching the two bases (bare legacy, `--*` structured, and
  // __Host- prefixed) so nothing but the cookie we set below survives.
  // We set the new token under the primary hexclave-refresh- name the SDK reads
  // first; using the legacy stack-refresh- name caused impersonation to silently
  // fail on production because not all deployed SDK versions fall back to it.
  const pid = encodeURIComponent(projectId);
  return deindent`
    document.cookie = 'hexclave-access=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
    document.cookie = 'stack-access=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
    var impersonationRefreshBases = ['hexclave-refresh-${pid}', 'stack-refresh-${pid}'];
    document.cookie.split(';').forEach(function (rawCookie) {
      var cookieName = rawCookie.split('=')[0].trim();
      if (!cookieName) return;
      var bareName = cookieName.replace(/^__Host-/, '');
      var matchesBase = impersonationRefreshBases.some(function (base) {
        return bareName === base || bareName.indexOf(base + '--') === 0;
      });
      if (matchesBase) {
        document.cookie = cookieName + '=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/' + (location.protocol === 'https:' ? '; secure' : '');
      }
    });
    document.cookie = (location.protocol === 'https:' ? '__Host-' : '') + 'hexclave-refresh-${pid}--default=' + encodeURIComponent(JSON.stringify({ refresh_token: ${JSON.stringify(refreshToken)}, updated_at_millis: Date.now() })) + '; expires=${expiresAtDate.toUTCString()}; path=/' + (location.protocol === 'https:' ? '; secure' : '');
    window.location.reload();
  `;
}


export function ImpersonateUserDialog(props: {
  user: ServerUser,
  impersonateSnippet: string | null,
  onClose: () => void,
}) {
  return <ActionDialog
    open={props.impersonateSnippet !== null}
    onOpenChange={(open) => !open && props.onClose()}
    title="Impersonate User"
    okButton
  >
    <Typography>
      Open your website and paste the following code into the browser console. This will replace the current session with the impersonated user session.
    </Typography>
    <CopyField
      type="textarea"
      monospace
      height={60}
      value={props.impersonateSnippet ?? ""}
    />
  </ActionDialog>;
}
