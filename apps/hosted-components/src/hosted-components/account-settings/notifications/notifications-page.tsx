import { Switch } from "~/components/ui";

import { useUser } from "@hexclave/react";
import { PageLayout } from "../page-layout";
import {
  getCardClassName,
  getSectionDescriptionClassName,
  getSectionTitleClassName,
  useDesign,
} from "../design-context";

export function NotificationsPage() {
  const user = useUser({ or: 'redirect' });
  const notificationCategories = user.useNotificationCategories();
  const design = useDesign();

  return (
    <PageLayout>
      <div className={getCardClassName(design, "flex flex-col gap-5")}>
        <div>
          <h3 className={getSectionTitleClassName(design)}>
            Email Notifications
          </h3>
          <p className={getSectionDescriptionClassName(design)}>
            Choose which emails you want to receive.
          </p>
        </div>

        <div className="flex flex-col gap-4">
          {notificationCategories.map((category) => (
            <div key={category.id} className="flex justify-between items-center py-2 border-b border-black/[0.04] dark:border-white/[0.04] last:border-0">
              <div className="flex flex-col">
                <span className="text-sm font-medium text-foreground">{category.name}</span>
                {!category.canDisable && (
                  <span className="text-xs text-muted-foreground/80 mt-0.5">
                    (Required for transactional updates and cannot be disabled)
                  </span>
                )}
              </div>
              <Switch
                checked={category.enabled}
                onCheckedChange={(value) => category.setEnabled(value)}
                disabled={!category.canDisable}
              />
            </div>
          ))}
        </div>
      </div>
    </PageLayout>
  );
}
