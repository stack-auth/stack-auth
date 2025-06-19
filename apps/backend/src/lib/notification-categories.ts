import { prismaClient } from "@/prisma-client";

// For now, we only have two hardcoded notification categories. TODO: query from database instead and create UI to manage them in dashboard
export const listNotificationCategories = () => {
  return [
    {
      id: "7bb82d33-2f54-4a3d-9d23-82739e0d66ef",
      name: "Transactional",
    },
    {
      id: "4f6f8873-3d04-46bd-8bef-18338b1a1b4c",
      name: "Marketing",
    },
  ];
};

export const getNotificationCategoryByName = (name: string) => {
  return listNotificationCategories().find((category) => category.name === name);
};

export const hasNotificationEnabled = async (tenancyId: string, userId: string, notificationCategoryId: string) => {
  const userNotificationPreference = await prismaClient.userNotificationPreference.findFirst({
    where: {
      tenancyId,
      projectUserId: userId,
      notificationCategoryId,
    },
  });
  if (!userNotificationPreference) {
    // Default to enabled if no preference is set
    return true;
  }
  return userNotificationPreference.enabled;
};
