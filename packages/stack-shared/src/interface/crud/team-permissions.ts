import { CrudTypeOf, createCrud } from "../../crud";
import * as schemaFields from "../../schema-fields";
import { yupMixed, yupObject } from "../../schema-fields";
import { WebhookEvent } from "../webhooks";

// =============== Team permissions =================

export const teamPermissionsCrudClientReadSchema = yupObject({
  id: schemaFields.teamPermissionDefinitionIdSchema.defined(),
  user_id: schemaFields.userIdSchema.defined(),
  team_id: schemaFields.teamIdSchema.defined(),
}).defined();

export const teamPermissionsCrudServerCreateSchema = yupObject({
}).defined();

export const teamPermissionsCrudServerDeleteSchema = yupMixed();

export const teamPermissionsCrud = createCrud({
  clientReadSchema: teamPermissionsCrudClientReadSchema,
  serverCreateSchema: teamPermissionsCrudServerCreateSchema,
  serverDeleteSchema: teamPermissionsCrudServerDeleteSchema,
  docs: {
    clientList: {
      summary: "List team permissions",
      description: "List team permissions of the current user. `user_id=me` must be set for client requests. Note that this might contain the permissions with the same permission ID across different teams. `(team_id, user_id, permission_id)` together uniquely identify a permission.",
      tags: ["Permissions"],
    },
    serverList: {
      summary: "List team permissions of a user",
      description: "Query and filter the permission with `team_id`, `user_id`, and `permission_id`. Note that this might contain the permissions with the same permission ID across different teams and users. `(team_id, user_id, permission_id)` together uniquely identify a permission.",
      tags: ["Permissions"],
    },
    serverCreate: {
      summary: "Grant a team permission to a user",
      description: "Grant a team permission to a user (the team permission must be created first on the Stack dashboard)",
      tags: ["Permissions"],
    },
    serverDelete: {
      summary: "Revoke a team permission from a user",
      description: "Revoke a team permission from a user",
      tags: ["Permissions"],
    },
  },
});
export type TeamPermissionsCrud = CrudTypeOf<typeof teamPermissionsCrud>;

export const teamPermissionCreatedWebhookEvent = {
  type: "team_permission.created",
  schema: teamPermissionsCrud.server.readSchema,
  metadata: {
    summary: "Team Permission Created",
    description: "This event is triggered when a team permission is created.",
    tags: ["Teams"],
  },
} satisfies WebhookEvent<typeof teamPermissionsCrud.server.readSchema>;

export const teamPermissionDeletedWebhookEvent = {
  type: "team_permission.deleted",
  schema: teamPermissionsCrud.server.readSchema,
  metadata: {
    summary: "Team Permission Deleted",
    description: "This event is triggered when a team permission is deleted.",
    tags: ["Teams"],
  },
} satisfies WebhookEvent<typeof teamPermissionsCrud.server.readSchema>;

// =============== Team permission definitions =================

export const teamPermissionDefinitionsCrudAdminReadSchema = yupObject({
  id: schemaFields.teamPermissionDefinitionIdSchema.defined(),
  description: schemaFields.teamPermissionDescriptionSchema.optional(),
  contained_permission_ids: schemaFields.containedPermissionIdsSchema.defined(),
}).defined();

export const teamPermissionDefinitionsCrudAdminCreateSchema = yupObject({
  id: schemaFields.customTeamPermissionDefinitionIdSchema.defined(),
  description: schemaFields.teamPermissionDescriptionSchema.optional(),
  contained_permission_ids: schemaFields.containedPermissionIdsSchema.optional(),
}).defined();

export const teamPermissionDefinitionsCrudAdminUpdateSchema = yupObject({
  id: schemaFields.customTeamPermissionDefinitionIdSchema.optional(),
  description: schemaFields.teamPermissionDescriptionSchema.optional(),
  contained_permission_ids: schemaFields.containedPermissionIdsSchema.optional(),
}).defined();

export const teamPermissionDefinitionsCrudAdminDeleteSchema = yupMixed();

export const teamPermissionDefinitionsCrud = createCrud({
  adminReadSchema: teamPermissionDefinitionsCrudAdminReadSchema,
  adminCreateSchema: teamPermissionDefinitionsCrudAdminCreateSchema,
  adminUpdateSchema: teamPermissionDefinitionsCrudAdminUpdateSchema,
  adminDeleteSchema: teamPermissionDefinitionsCrudAdminDeleteSchema,
  docs: {
    adminList: {
      summary: "List team permission definitions",
      description: "Query and filter the permission with team_id, user_id, and permission_id (the equivalent of listing permissions on the Stack dashboard)",
      tags: ["Permissions"],
    },
    adminCreate: {
      summary: "Create a new team permission definition",
      description: "Create a new permission definition (the equivalent of creating a new permission on the Stack dashboard)",
      tags: ["Permissions"],
    },
    adminUpdate: {
      summary: "Update a team permission definition",
      description: "Update a permission definition (the equivalent of updating a permission on the Stack dashboard)",
      tags: ["Permissions"],
    },
    adminDelete: {
      summary: "Delete a team permission definition",
      description: "Delete a permission definition (the equivalent of deleting a permission on the Stack dashboard)",
      tags: ["Permissions"],
    },
  },
});

export type TeamPermissionDefinitionsCrud = CrudTypeOf<typeof teamPermissionDefinitionsCrud>;
