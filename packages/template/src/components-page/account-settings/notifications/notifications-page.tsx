import { useUser } from "../../../lib/hooks";
import { useTranslation } from "../../../lib/translations";
import { PageLayout } from "../page-layout";
import { Switch } from "@stackframe/stack-ui";
import { Separator, Typography } from "@stackframe/stack-ui";


export function NotificationsPage() {
  const { t } = useTranslation();
  const user = useUser({ or: 'redirect' });
  const notificationCategories = user.useNotificationCategories();

  return (
    <PageLayout>
      <Separator />
      <div className='flex flex-col gap-2'>
        <div className='sm:flex-1 flex flex-col justify-center pb-2'>
          <Typography className="font-medium">
            {t('Choose which emails you want to receive')}
          </Typography>
        </div>
        {notificationCategories.map((category) => (
          <div key={category.id} className="flex justify-start gap-4 items-center">
            <Switch
              checked={category.enabled}
              onCheckedChange={(value) => void category.setEnabled(value)}
              disabled={!category.canDisable}
            />
            <Typography>{category.name}</Typography>
            {!category.canDisable && (
              <Typography variant='secondary' type='footnote'>
                (cannot be disabled)
              </Typography>
            )}
          </div>
        ))}
      </div>
    </PageLayout>
  );
}
