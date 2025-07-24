import { CrudTypeOf, createCrud } from "../../crud";
import * as schemaFields from "../../schema-fields";
import { yupObject } from "../../schema-fields";

export const environmentConfigCrudAdminReadSchema = yupObject({
  project_id: schemaFields.yupString().defined(),
  branch_id: schemaFields.yupString().defined(),
  organization_id: schemaFields.yupString().optional(),
  id: schemaFields.yupString().defined(),
  config: schemaFields.yupMixed().defined(),
}).defined();

export const environmentConfigCrudAdminUpdateSchema = yupObject({
  config: schemaFields.yupMixed().optional(),
}).defined();

export const environmentConfigCrud = createCrud({
  adminReadSchema: environmentConfigCrudAdminReadSchema,
  adminUpdateSchema: environmentConfigCrudAdminUpdateSchema,
  docs: {
    adminRead: {
      summary: 'Get the current environment config',
      description: 'Get the current environment config',
      tags: ['Environment Config'],
    },
    adminUpdate: {
      summary: 'Update the current environment config',
      description: 'Update the current environment config',
      tags: ['Environment Config'],
    },
  },
});
export type EnvironmentConfigCrud = CrudTypeOf<typeof environmentConfigCrud>;
