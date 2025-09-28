import { createCrud, CrudTypeOf } from "../../crud";
import { yupBoolean, yupNumber, yupObject, yupString } from "../../schema-fields";


const itemReadSchema = yupObject({
  id: yupString().defined(),
  display_name: yupString().defined(),
  quantity: yupNumber().defined(),
}).defined();

const itemUpdateSchema = yupObject({
  delta: yupNumber().defined(),
  expires_at: yupString().optional(),
  description: yupString().optional(),
  allow_negative: yupBoolean().optional(),
}).defined();


export const itemCrud = createCrud({
  clientReadSchema: itemReadSchema,
  serverUpdateSchema: itemUpdateSchema,
});

export type ItemCrud = CrudTypeOf<typeof itemCrud>;
