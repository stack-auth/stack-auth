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
  const pidJson = JSON.stringify(projectId);
  const tokenJson = JSON.stringify(refreshToken);
  return deindent`
    (function(){
      var isSecure = location.protocol === 'https:';
      ['hexclave-access', 'stack-access'].forEach(function(n) {
        document.cookie = n + '=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
        document.cookie = n + '=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; secure';
      });
      var name = (isSecure ? '__Host-' : '') + 'hexclave-refresh-' + ${pidJson} + '--default';
      var val = encodeURIComponent(JSON.stringify({ refresh_token: ${tokenJson}, updated_at_millis: Date.now() }));
      document.cookie = name + '=' + val + '; expires=${expiresAtDate.toUTCString()}; path=/' + (isSecure ? '; secure' : '');
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
