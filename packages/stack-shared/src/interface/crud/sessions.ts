import { CrudTypeOf, createCrud } from "../../crud";
import { yupBoolean, yupMixed, yupNumber, yupObject, yupString } from "../../schema-fields";

export const sessionsCrudServerCreateSchema = yupObject({
  user_id: yupString().uuid().defined(),
  expires_in_millis: yupNumber().max(1000 * 60 * 60 * 24 * 367).default(1000 * 60 * 60 * 24 * 365),
  is_impersonation: yupBoolean().default(false),
}).defined();

export const sessionsCrudServerReadSchema = yupObject({
  id: yupString().uuid().defined(),
  user_id: yupString().uuid().defined(),
  created_at: yupNumber().defined(),
  expires_at: yupNumber().nullable().defined(),
  is_impersonation: yupBoolean().defined(),
}).defined();

export const sessionsCrudServerDeleteSchema = yupMixed();

export const sessionsCrud = createCrud({
  serverCreateSchema: sessionsCrudServerCreateSchema,
  serverReadSchema: sessionsCrudServerReadSchema,
  serverDeleteSchema: sessionsCrudServerDeleteSchema,
  docs: {
    serverCreate: {
      summary: "Create session",
      description: "Create a new session for a given user. This will return a refresh token that can be used to impersonate the user.",
      tags: ["Sessions"],
    },
    serverRead: {
      summary: "Get session",
      description: "Get a session by ID.",
      tags: ["Sessions"],
    },
    serverList: {
      summary: "List sessions",
      description: "List all sessions for the current user.",
      tags: ["Sessions"],
    },
    serverDelete: {
      summary: "Delete session",
      description: "Delete a session by ID.",
      tags: ["Sessions"],
    },
  },
});
export type SessionsCrud = CrudTypeOf<typeof sessionsCrud>;
