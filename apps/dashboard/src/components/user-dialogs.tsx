import { ServerUser } from '@hexclave/next';
import { ActionDialog, CopyField, Typography } from "@/components/ui";
import { runAsynchronouslyWithAlert } from "@hexclave/shared/dist/utils/promises";
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

export function generateImpersonateSnippet(
  projectId: string,
  refreshToken: string,
  expiresAtDate: Date,
): string {
  const pid = encodeURIComponent(projectId);
  return deindent`
    var impersonationValue = encodeURIComponent(JSON.stringify({ refresh_token: ${JSON.stringify(refreshToken)}, updated_at_millis: Date.now() }));
    var impersonationAttributes = '; expires=${expiresAtDate.toUTCString()}; path=/' + (location.protocol === 'https:' ? '; secure' : '');
    document.cookie = (location.protocol === 'https:' ? '__Host-' : '') + 'hexclave-refresh-${pid}--default=' + impersonationValue + impersonationAttributes;
    document.cookie = 'stack-refresh-${pid}--default=' + impersonationValue + impersonationAttributes;
    document.cookie = 'stack-refresh-${pid}=' + encodeURIComponent(${JSON.stringify(refreshToken)}) + impersonationAttributes;
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
