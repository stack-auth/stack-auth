import { createCrud, CrudTypeOf } from "../../crud";
import { yupNumber, yupObject, yupString } from "../../schema-fields";


const itemReadSchema = yupObject({
  id: yupString().defined(),
  display_name: yupString().defined(),
  quantity: yupNumber().defined(),
}).defined();


export const itemCrud = createCrud({
  clientReadSchema: itemReadSchema,
});

export type ItemCrud = CrudTypeOf<typeof itemCrud>;
