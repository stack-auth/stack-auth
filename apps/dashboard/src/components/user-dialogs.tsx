import { ServerUser } from '@hexclave/next';
import { ActionDialog, CopyField, Typography } from "@/components/ui";
import { deindent } from "@hexclave/shared/dist/utils/strings";
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
  const userLabel = props.user.displayName ?? props.user.primaryEmail ?? props.user.id;
  return <ActionDialog
    open={props.open}
    onOpenChange={props.onOpenChange}
    title="Delete User"
    danger
    cancelButton
    okButton={{
      label: "Delete User", onClick: async () => {
        await props.user.delete();
        await props.onDeleted?.();
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
        onClick={(event) => {
          event.preventDefault();
          props.onOpenChange(false);
          router.push(props.profileHref);
        }}
      >
        {userLabel}
      </Link>&quot;?
    </Typography>
  </ActionDialog>;
}

export function generateImpersonateSnippet(
  projectId: string,
  refreshToken: string,
  expiresAtDate: Date,
): string {
  return deindent`
    document.cookie = 'hexclave-access=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
    document.cookie = 'stack-access=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
    document.cookie = 'hexclave-refresh-${encodeURIComponent(projectId)}--default=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
    document.cookie = '__Host-hexclave-refresh-${encodeURIComponent(projectId)}--default=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/' + (location.protocol === 'https:' ? '; secure' : '');
    document.cookie = (location.protocol === 'https:' ? '__Host-' : '') + 'stack-refresh-${encodeURIComponent(projectId)}--default=' + encodeURIComponent(JSON.stringify({ refresh_token: ${JSON.stringify(refreshToken)}, updated_at_millis: Date.now() })) + '; expires=${expiresAtDate.toUTCString()}; path=/' + (location.protocol === 'https:' ? '; secure' : '');
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
