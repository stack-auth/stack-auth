import { CrudTypeOf, createCrud } from "../../crud";
import * as schemaFields from "../../schema-fields";
import { yupObject } from "../../schema-fields";

export const tenancyCrudAdminReadSchema = yupObject({
  project_id: schemaFields.yupString().defined(),
  branch_id: schemaFields.yupString().defined(),
  organization_id: schemaFields.yupString().optional(),
  id: schemaFields.yupString().defined(),
  config: schemaFields.yupMixed().defined(),
}).defined();

export const tenancyCrudAdminUpdateSchema = yupObject({
  config: schemaFields.yupMixed().optional(),
}).defined();

export const tenancyCrud = createCrud({
  adminReadSchema: tenancyCrudAdminReadSchema,
  adminUpdateSchema: tenancyCrudAdminUpdateSchema,
  docs: {
    adminRead: {
      summary: 'Get the current tenancy',
      description: 'Get the current tenancy information and configuration',
      tags: ['Tenancies'],
    },
    adminUpdate: {
      summary: 'Update the current tenancy',
      description: 'Update the current tenancy information and configuration',
      tags: ['Tenancies'],
    },
  },
});
export type TenancyCrud = CrudTypeOf<typeof tenancyCrud>;
