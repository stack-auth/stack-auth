import { CrudTypeOf, createCrud } from "../../crud";
import * as schemaFields from "../../schema-fields";
import { yupMixed, yupObject } from "../../schema-fields";
import { WebhookEvent } from "../webhooks";

// =============== User permissions =================

export const userPermissionsCrudClientReadSchema = yupObject({
  id: schemaFields.teamPermissionDefinitionIdSchema.defined(),
  user_id: schemaFields.userIdSchema.defined(),
}).defined();

export const userPermissionsCrudServerCreateSchema = yupObject({
}).defined();

export const userPermissionsCrudServerDeleteSchema = yupMixed();

export const userPermissionsCrud = createCrud({
  clientReadSchema: userPermissionsCrudClientReadSchema,
  serverCreateSchema: userPermissionsCrudServerCreateSchema,
  serverDeleteSchema: userPermissionsCrudServerDeleteSchema,
  docs: {
    clientList: {
      summary: "List user permissions",
      description: "List global permissions of the current user. `user_id=me` must be set for client requests. `(user_id, permission_id)` together uniquely identify a permission.",
      tags: ["Permissions"],
    },
    serverList: {
      summary: "List user permissions",
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
export type UserPermissionsCrud = CrudTypeOf<typeof userPermissionsCrud>;

export const userPermissionCreatedWebhookEvent = {
  type: "user_permission.created",
  schema: userPermissionsCrud.server.readSchema,
  metadata: {
    summary: "User Permission Created",
    description: "This event is triggered when a user permission is created.",
    tags: ["Users"],
  },
} satisfies WebhookEvent<typeof userPermissionsCrud.server.readSchema>;

export const userPermissionDeletedWebhookEvent = {
  type: "user_permission.deleted",
  schema: userPermissionsCrud.server.readSchema,
  metadata: {
    summary: "User Permission Deleted",
    description: "This event is triggered when a user permission is deleted.",
    tags: ["Users"],
  },
} satisfies WebhookEvent<typeof userPermissionsCrud.server.readSchema>;
