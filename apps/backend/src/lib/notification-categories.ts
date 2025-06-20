import { prismaClient } from "@/prisma-client";
import { StackAssertionError } from "@stackframe/stack-shared/dist/utils/errors";

// For now, we only have two hardcoded notification categories. TODO: query from database instead and create UI to manage them in dashboard
export const listNotificationCategories = () => {
  return [
    {
      id: "7bb82d33-2f54-4a3d-9d23-82739e0d66ef",
      name: "Transactional",
      default_enabled: true,
      can_disable: false,
    },
    {
      id: "4f6f8873-3d04-46bd-8bef-18338b1a1b4c",
      name: "Marketing",
      default_enabled: true,
      can_disable: true,
    },
  ];
};

export const getNotificationCategoryByName = (name: string) => {
  return listNotificationCategories().find((category) => category.name === name);
};

export const hasNotificationEnabled = async (tenancyId: string, userId: string, notificationCategoryId: string) => {
  const notificationCategory = listNotificationCategories().find((category) => category.id === notificationCategoryId);
  if (!notificationCategory) {
    throw new StackAssertionError('Invalid notification category id', { notificationCategoryId });
  }
  const userNotificationPreference = await prismaClient.userNotificationPreference.findFirst({
    where: {
      tenancyId,
      projectUserId: userId,
      notificationCategoryId,
    },
  });
  if (!userNotificationPreference) {
    return notificationCategory.default_enabled;
  }
  return userNotificationPreference.enabled;
};
