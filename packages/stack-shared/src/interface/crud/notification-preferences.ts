import { createCrud, CrudTypeOf } from "../../crud";
import { yupBoolean, yupObject, yupString } from "../../schema-fields";


const notificationPreferenceReadSchema = yupObject({
  notification_category_id: yupString().defined(),
  notification_category_name: yupString().defined(),
  enabled: yupBoolean().defined(),
}).defined();

const notificationPreferenceUpdateSchema = yupObject({
  user_id: yupString().defined(),
  notification_category_id: yupString().defined(),
  enabled: yupBoolean().defined(),
}).defined();

export const notificationPreferenceCrud = createCrud({
  clientReadSchema: notificationPreferenceReadSchema,
  clientUpdateSchema: notificationPreferenceUpdateSchema,
});

export type NotificationPreferenceCrud = CrudTypeOf<typeof notificationPreferenceCrud>;
