import { createCrud, CrudTypeOf } from "../../crud";
import { yupBoolean, yupObject, yupString } from "../../schema-fields";


const notificationPreferenceReadSchema = yupObject({
  notification_category_id: yupString().defined(),
  notification_category_name: yupString().defined(),
  enabled: yupBoolean().defined(),
}).defined();

const notificationPreferenceCreateSchema = yupObject({
  user_id: yupString().defined(),
  notification_category_id: yupString().defined(),
  enabled: yupBoolean().defined(),
}).defined();

export const notificationPreferenceCrud = createCrud({
  adminReadSchema: notificationPreferenceReadSchema,
  adminCreateSchema: notificationPreferenceCreateSchema,
  clientReadSchema: notificationPreferenceReadSchema,
  clientCreateSchema: notificationPreferenceCreateSchema,
});

export type NotificationPreferenceCrud = CrudTypeOf<typeof notificationPreferenceCrud>;
