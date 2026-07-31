import { CrudTypeOf, createCrud } from "../../crud";
import { commsConversationSchema } from "../comms";
import { yupObject, yupString } from "../../schema-fields";

export const commsConversationsCrudServerReadSchema = commsConversationSchema;

export const commsConversationsCrudServerCreateSchema = yupObject({
  title: yupString().nullable().optional(),
}).defined();

export const commsConversationsCrudServerUpdateSchema = yupObject({
  title: yupString().nullable().optional(),
}).defined();

export const commsConversationsCrud = createCrud({
  serverReadSchema: commsConversationsCrudServerReadSchema,
  serverCreateSchema: commsConversationsCrudServerCreateSchema,
  serverUpdateSchema: commsConversationsCrudServerUpdateSchema,
  docs: {
    serverCreate: {
      tags: ["Comms"],
      summary: "Create conversation",
      description: "Creates an empty communications conversation. Prefer message ingestion for automatic conversation assignment.",
    },
    serverRead: {
      tags: ["Comms"],
      summary: "Get conversation",
      description: "Gets a communications conversation by ID.",
    },
    serverUpdate: {
      tags: ["Comms"],
      summary: "Update conversation",
      description: "Updates mutable conversation fields such as title. Message assignment changes must use merge, split, or reassign operations.",
    },
    serverList: {
      tags: ["Comms"],
      summary: "List conversations",
      description: "Lists communications conversations in the current tenancy.",
    },
  },
});

export type CommsConversationsCrud = CrudTypeOf<typeof commsConversationsCrud>;
