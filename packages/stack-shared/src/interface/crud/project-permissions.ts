import { CrudTypeOf, createCrud } from "../../crud";
import * as schemaFields from "../../schema-fields";
import { yupMixed, yupObject } from "../../schema-fields";
import { WebhookEvent } from "../webhooks";

// =============== Project permissions =================

export const projectPermissionsCrudClientReadSchema = yupObject({
  id: schemaFields.permissionDefinitionIdSchema.defined(),
  user_id: schemaFields.userIdSchema.defined(),
}).defined();

export const projectPermissionsCrudServerCreateSchema = yupObject({
}).defined();

export const projectPermissionsCrudServerDeleteSchema = yupMixed();

export const projectPermissionsCrud = createCrud({
  clientReadSchema: projectPermissionsCrudClientReadSchema,
  serverCreateSchema: projectPermissionsCrudServerCreateSchema,
  serverDeleteSchema: projectPermissionsCrudServerDeleteSchema,
  docs: {
    clientList: {
      summary: "List project permissions",
      description: "List global permissions of the current user. `user_id=me` must be set for client requests. `(user_id, permission_id)` together uniquely identify a permission.",
      tags: ["Permissions"],
    },
    serverList: {
      summary: "List project permissions",
      description: "Query and filter the permission with `user_id` and `permission_id`. `(user_id, permission_id)` together uniquely identify a permission.",
      tags: ["Permissions"],
    },
    serverCreate: {
      summary: "Grant a global permission to a user",
      description: "Grant a global permission to a user (the permission must be created first on the Stack dashboard)",
      tags: ["Permissions"],
    },
    serverDelete: {
      summary: "Revoke a global permission from a user",
      description: "Revoke a global permission from a user",
      tags: ["Permissions"],
    },
  },
});
export type ProjectPermissionsCrud = CrudTypeOf<typeof projectPermissionsCrud>;

export const projectPermissionCreatedWebhookEvent = {
  type: "project_permission.created",
  schema: projectPermissionsCrud.server.readSchema,
  metadata: {
    summary: "Project Permission Created",
    description: "This event is triggered when a project permission is created.",
    tags: ["Users"],
  },
} satisfies WebhookEvent<typeof projectPermissionsCrud.server.readSchema>;

export const projectPermissionDeletedWebhookEvent = {
  type: "project_permission.deleted",
  schema: projectPermissionsCrud.server.readSchema,
  metadata: {
    summary: "Project Permission Deleted",
    description: "This event is triggered when a project permission is deleted.",
    tags: ["Users"],
  },
} satisfies WebhookEvent<typeof projectPermissionsCrud.server.readSchema>;

// =============== Project permission definitions =================

export const projectPermissionDefinitionsCrudAdminReadSchema = yupObject({
  id: schemaFields.permissionDefinitionIdSchema.defined(),
  description: schemaFields.teamPermissionDescriptionSchema.optional(),
  contained_permission_ids: schemaFields.containedPermissionIdsSchema.defined(),
}).defined();

export const projectPermissionDefinitionsCrudAdminCreateSchema = yupObject({
  id: schemaFields.customPermissionDefinitionIdSchema.defined(),
  description: schemaFields.teamPermissionDescriptionSchema.optional(),
  contained_permission_ids: schemaFields.containedPermissionIdsSchema.optional(),
}).defined();

export const projectPermissionDefinitionsCrudAdminUpdateSchema = yupObject({
  id: schemaFields.customPermissionDefinitionIdSchema.optional(),
  description: schemaFields.teamPermissionDescriptionSchema.optional(),
  contained_permission_ids: schemaFields.containedPermissionIdsSchema.optional(),
}).defined();

export const projectPermissionDefinitionsCrudAdminDeleteSchema = yupMixed();

export const projectPermissionDefinitionsCrud = createCrud({
  adminReadSchema: projectPermissionDefinitionsCrudAdminReadSchema,
  adminCreateSchema: projectPermissionDefinitionsCrudAdminCreateSchema,
  adminUpdateSchema: projectPermissionDefinitionsCrudAdminUpdateSchema,
  adminDeleteSchema: projectPermissionDefinitionsCrudAdminDeleteSchema,
  docs: {
    adminList: {
      summary: "List project permission definitions",
      description: "Query and filter project permission definitions (the equivalent of listing permissions on the Stack dashboard)",
      tags: ["Permissions"],
    },
    adminCreate: {
      summary: "Create a new project permission definition",
      description: "Create a new project permission definition (the equivalent of creating a new permission on the Stack dashboard)",
      tags: ["Permissions"],
    },
    adminUpdate: {
      summary: "Update a project permission definition",
      description: "Update a project permission definition (the equivalent of updating a permission on the Stack dashboard)",
      tags: ["Permissions"],
    },
    adminDelete: {
      summary: "Delete a project permission definition",
      description: "Delete a project permission definition (the equivalent of deleting a permission on the Stack dashboard)",
      tags: ["Permissions"],
    },
  },
});

export type ProjectPermissionDefinitionsCrud = CrudTypeOf<typeof projectPermissionDefinitionsCrud>;
