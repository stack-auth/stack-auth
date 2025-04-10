import { CrudTypeOf, createCrud } from "../../crud";
import * as schemaFields from "../../schema-fields";
import { yupObject } from "../../schema-fields";

const apiKeySchema = yupObject({
  id: schemaFields.yupString().uuid().defined(),
  created_at_millis: schemaFields.yupNumber().defined(),
  description: schemaFields.yupString().defined(),
  expires_at_millis: schemaFields.yupNumber().nullable(),
  is_revoked: schemaFields.yupBoolean().defined(),
}).defined();

export const apiKeysCrud = createCrud({
  clientReadSchema: apiKeySchema,
  clientListSchema: yupObject({
    items: schemaFields.yupArray(apiKeySchema).defined(),
  }).defined(),
  docs: {
    clientRead: {
      summary: "Get an API key",
      description: "",
      tags: ["API Keys"],
    },
    clientList: {
      summary: "List API keys",
      description: "",
      tags: ["API Keys"],
    },
  },
});

export type ApiKeysCrud = CrudTypeOf<typeof apiKeysCrud>;