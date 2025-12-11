import { createCrud, CrudTypeOf } from "../../crud";
import { yupBoolean, yupObject, yupString } from "../../schema-fields";


const notificationPreferenceReadSchema = yupObject({
  notification_category_id: yupString().defined(),
  notification_category_name: yupString().defined(),
  enabled: yupBoolean().defined(),
  can_disable: yupBoolean().defined(),
}).defined();

const notificationPreferenceUpdateSchema = yupObject({
  enabled: yupBoolean().defined(),
}).defined();

export const notificationPreferenceCrud = createCrud({
  clientReadSchema: notificationPreferenceReadSchema,
  clientUpdateSchema: notificationPreferenceUpdateSchema,
  docs: {
    clientList: {
      summary: "List notification preferences",
      description: "Get all notification preferences for a user, showing which notification categories are enabled or disabled.",
      tags: ["Emails"],
    },
    clientUpdate: {
      summary: "Update notification preference",
      description: "Enable or disable a specific notification category for a user.",
      tags: ["Emails"],
    },
  },
});

export type NotificationPreferenceCrud = CrudTypeOf<typeof notificationPreferenceCrud>;
