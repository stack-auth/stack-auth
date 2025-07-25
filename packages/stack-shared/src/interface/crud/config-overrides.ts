import { CrudTypeOf, createCrud } from "../../crud";
import * as schemaFields from "../../schema-fields";
import { yupObject } from "../../schema-fields";

export const configOverridesCrudAdminReadSchema = yupObject({
  project_id: schemaFields.yupString().defined(),
  branch_id: schemaFields.yupString().defined(),
  organization_id: schemaFields.yupString().optional(),
  id: schemaFields.yupString().defined(),
  config: schemaFields.yupString().defined(),
}).defined();

export const configOverridesCrudAdminUpdateSchema = yupObject({
  config: schemaFields.yupString().optional(),
}).defined();

export const configOverridesCrud = createCrud({
  adminReadSchema: configOverridesCrudAdminReadSchema,
  adminUpdateSchema: configOverridesCrudAdminUpdateSchema,
  docs: {
    adminRead: {
      summary: 'Get the current config overrides',
      description: 'Get the current config overrides with the specified project id and branch id',
      tags: ['Config'],
    },
    adminUpdate: {
      summary: 'Update the current config overrides',
      description: 'Update the current config overrides with the specified project id and branch id',
      tags: ['Config'],
    },
  },
});
export type ConfigOverridesCrud = CrudTypeOf<typeof configOverridesCrud>;
