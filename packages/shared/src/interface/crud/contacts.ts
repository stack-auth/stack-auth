import { CrudTypeOf, createCrud } from "../../crud";
import {
  contactCreateSchema,
  contactSchema,
  contactUpdateSchema,
} from "../comms";
import { yupMixed } from "../../schema-fields";

export const contactsCrudServerReadSchema = contactSchema;
export const contactsCrudServerCreateSchema = contactCreateSchema;
export const contactsCrudServerUpdateSchema = contactUpdateSchema;
export const contactsCrudServerDeleteSchema = yupMixed();

export const contactsCrud = createCrud({
  serverReadSchema: contactsCrudServerReadSchema,
  serverCreateSchema: contactsCrudServerCreateSchema,
  serverUpdateSchema: contactsCrudServerUpdateSchema,
  serverDeleteSchema: contactsCrudServerDeleteSchema,
  docs: {
    serverCreate: {
      tags: ["Contacts"],
      summary: "Create contact",
      description: "Creates a CRM contact. Contacts may exist without a corresponding user. User-backed contacts share the user's UUID and are created automatically when a user is created.",
    },
    serverRead: {
      tags: ["Contacts"],
      summary: "Get contact",
      description: "Gets a contact by ID, including its contact channels. Merged contacts retain a redirect to the canonical contact.",
    },
    serverUpdate: {
      tags: ["Contacts"],
      summary: "Update contact",
      description: "Updates profile fields on a contact. Only the values provided will be updated.",
    },
    serverDelete: {
      tags: ["Contacts"],
      summary: "Delete contact",
      description: "Deletes a contact that is not user-backed. Contacts with a same-UUID ProjectUser cannot be deleted.",
    },
    serverList: {
      tags: ["Contacts"],
      summary: "List contacts",
      description: "Lists contacts in the current tenancy.",
    },
  },
});

export type ContactsCrud = CrudTypeOf<typeof contactsCrud>;
