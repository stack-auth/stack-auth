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


/**
 * Generates a JS snippet that clears existing auth cookies and sets a
 * structured refresh token so impersonation works without logging out first.
 *
 * The SDK reads structured `hexclave-refresh-{pid}--default` cookies before
 * legacy `stack-refresh-{pid}` ones, so simply setting the legacy cookie is
 * ignored when a structured cookie already exists. This snippet deletes all
 * refresh/access cookies for the project and writes the token in the structured
 * format the SDK expects.
 */
export function generateImpersonateSnippet(
  projectId: string,
  refreshToken: string,
  expiresAtDate: Date,
): string {
  const pidJson = JSON.stringify(projectId);
  const tokenJson = JSON.stringify(refreshToken);
  return deindent`
    (function(){
      var pid = ${pidJson};
      var prefixes = [
        'hexclave-refresh-' + pid, '__Host-hexclave-refresh-' + pid,
        'stack-refresh-' + pid, '__Host-stack-refresh-' + pid
      ];
      var exact = ['stack-refresh', 'hexclave-access', 'stack-access'];
      document.cookie.split(';').forEach(function(c) {
        var n = c.trim().split('=')[0];
        if (exact.indexOf(n) >= 0 || prefixes.some(function(p) { return n.indexOf(p) === 0; })) {
          document.cookie = n + '=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
          document.cookie = n + '=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; secure';
        }
      });
      var pre = location.protocol === 'https:' ? '__Host-' : '';
      var val = encodeURIComponent(JSON.stringify({ refresh_token: ${tokenJson}, updated_at_millis: Date.now() }));
      var attrs = '; expires=${expiresAtDate.toUTCString()}; path=/' + (location.protocol === 'https:' ? '; secure' : '');
      document.cookie = pre + 'hexclave-refresh-' + pid + '--default=' + val + attrs;
      location.reload();
    })();
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
