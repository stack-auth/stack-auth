'use client';

import { useUser } from "@hexclave/next";
import { PageLayout } from "../page-layout";
import { Switch } from "@/components/ui/switch";

export function NotificationsPage() {
  const user = useUser({ or: 'redirect' });
  const notificationCategories = user.useNotificationCategories();

  return (
    <PageLayout>
      <div className="border border-black/[0.08] dark:border-white/[0.08] bg-white/80 dark:bg-background/80 backdrop-blur-xl rounded-2xl p-6 shadow-sm ring-1 ring-black/[0.04] dark:ring-0 flex flex-col gap-5">
        <div>
          <h3 className="font-semibold text-base text-foreground leading-snug">
            Email Notifications
          </h3>
          <p className="text-muted-foreground text-sm mt-1 leading-relaxed">
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
                onCheckedChange={(value) => void category.setEnabled(value)}
                disabled={!category.canDisable}
              />
            </div>
          ))}
        </div>
      </div>
    </PageLayout>
  );
}
