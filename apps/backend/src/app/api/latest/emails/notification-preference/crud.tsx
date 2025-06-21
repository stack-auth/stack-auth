import { listNotificationCategories } from "@/lib/notification-categories";
import { ensureUserExists } from "@/lib/request-checks";
import { prismaClient } from "@/prisma-client";
import { createCrudHandlers } from "@/route-handlers/crud-handler";
import { KnownErrors } from "@stackframe/stack-shared";
import { notificationPreferenceCrud, NotificationPreferenceCrud } from "@stackframe/stack-shared/dist/interface/crud/notification-preferences";
import { userIdOrMeSchema, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { StatusError, throwErr } from "@stackframe/stack-shared/dist/utils/errors";
import { createLazyProxy } from "@stackframe/stack-shared/dist/utils/proxies";

export const notificationPreferencesCrudHandlers = createLazyProxy(() => createCrudHandlers(notificationPreferenceCrud, {
  paramsSchema: yupObject({
    user_id: userIdOrMeSchema.defined(),
    notification_category_id: yupString().uuid().optional(),
  }),
  onUpdate: async ({ auth, params, data }) => {
    const userId = params.user_id === 'me' ? (auth.user?.id ?? throwErr(new KnownErrors.UserAuthenticationRequired())) : params.user_id;
    const notificationCategories = listNotificationCategories();
    const notificationCategory = notificationCategories.find(c => c.id === params.notification_category_id);
    if (!notificationCategory || !params.notification_category_id) {
      throw new StatusError(404, "Notification category not found");
    }

    if (auth.type === 'client') {
      if (!auth.user) {
        throw new KnownErrors.UserAuthenticationRequired();
      }
      if (userId !== auth.user.id) {
        throw new StatusError(StatusError.Forbidden, "You can only manage your own notification preferences");
      }
    }
    await ensureUserExists(prismaClient, { tenancyId: auth.tenancy.id, userId });

    const notificationPreference = await prismaClient.userNotificationPreference.upsert({
      where: {
        tenancyId_projectUserId_notificationCategoryId: {
          tenancyId: auth.tenancy.id,
          projectUserId: userId,
          notificationCategoryId: params.notification_category_id,
        },
      },
      update: {
        enabled: data.enabled,
      },
      create: {
        tenancyId: auth.tenancy.id,
        projectUserId: userId,
        notificationCategoryId: params.notification_category_id,
        enabled: data.enabled,
      },
    });

    return {
      notification_category_id: notificationPreference.notificationCategoryId,
      notification_category_name: notificationCategory.name,
      enabled: notificationPreference.enabled,
      can_disable: notificationCategory.can_disable,
    };
  },
  onList: async ({ auth, params }) => {
    const userId = params.user_id === 'me' ? (auth.user?.id ?? throwErr(new KnownErrors.UserAuthenticationRequired)) : params.user_id;

    if (!userId) {
      throw new KnownErrors.UserAuthenticationRequired;
    }
    if (auth.type === 'client') {
      if (!auth.user) {
        throw new KnownErrors.UserAuthenticationRequired;
      }
      if (userId && userId !== auth.user.id) {
        throw new StatusError(StatusError.Forbidden, "You can only view your own notification preferences");
      }
    }
    await ensureUserExists(prismaClient, { tenancyId: auth.tenancy.id, userId });

    const notificationPreferences = await prismaClient.userNotificationPreference.findMany({
      where: {
        tenancyId: auth.tenancy.id,
        projectUserId: userId,
      },
      select: {
        notificationCategoryId: true,
        enabled: true,
      },
    });

    const notificationCategories = listNotificationCategories();
    const items: NotificationPreferenceCrud["Client"]["Read"][] = notificationCategories.map(category => {
      const preference = notificationPreferences.find(p => p.notificationCategoryId === category.id);
      return {
        notification_category_id: category.id,
        notification_category_name: category.name,
        enabled: preference?.enabled ?? category.default_enabled,
        can_disable: category.can_disable,
      };
    });

    return {
      items,
      is_paginated: false,
    };
  },
}));
