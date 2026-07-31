import { CrudTypeOf, createCrud } from "../../crud";
import { commsMessageIngestSchema, commsMessageSchema } from "../comms";

export const commsMessagesCrudServerReadSchema = commsMessageSchema;
export const commsMessagesCrudServerCreateSchema = commsMessageIngestSchema;

export const commsMessagesCrud = createCrud({
  serverReadSchema: commsMessagesCrudServerReadSchema,
  serverCreateSchema: commsMessagesCrudServerCreateSchema,
  docs: {
    serverCreate: {
      tags: ["Comms"],
      summary: "Ingest message",
      description: "Idempotently ingests an immutable communications message. Conversation assignment prefers reply-to, then external thread, otherwise creates a new conversation.",
    },
    serverRead: {
      tags: ["Comms"],
      summary: "Get message",
      description: "Gets a communications message by ID, including participants, attachments, and relations.",
    },
    serverList: {
      tags: ["Comms"],
      summary: "List messages",
      description: "Lists messages for a conversation in chronological order.",
    },
  },
});

export type CommsMessagesCrud = CrudTypeOf<typeof commsMessagesCrud>;
