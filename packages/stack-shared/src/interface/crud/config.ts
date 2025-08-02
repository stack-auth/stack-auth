import { CrudTypeOf, createCrud } from "../../crud";
import * as schemaFields from "../../schema-fields";
import { yupObject } from "../../schema-fields";

export const configOverrideCrudAdminReadSchema = yupObject({}).defined();

export const configOverrideCrudAdminUpdateSchema = yupObject({
  config_override_string: schemaFields.yupString().optional(),
}).defined();

export const configOverrideCrud = createCrud({
  adminReadSchema: configOverrideCrudAdminReadSchema,
  adminUpdateSchema: configOverrideCrudAdminUpdateSchema,
  docs: {
    adminUpdate: {
      summary: 'Update the config',
      description: 'Update the config for a project and branch with an override',
      tags: ['Config'],
    },
  },
});
export type ConfigOverrideCrud = CrudTypeOf<typeof configOverrideCrud>;

export const configCrudAdminReadSchema = yupObject({
  config_string: schemaFields.yupString().defined(),
}).defined();

export const configCrud = createCrud({
  adminReadSchema: configCrudAdminReadSchema,
  docs: {
    adminRead: {
      summary: 'Get the config',
      description: 'Get the config for a project and branch',
      tags: ['Config'],
    },
  },
});
export type ConfigCrud = CrudTypeOf<typeof configCrud>;
