import { CrudTypeOf, createCrud } from "../../crud";
import * as schemaFields from "../../schema-fields";
import { yupObject } from "../../schema-fields";

export const teamInvitationDetailsClientReadSchema = yupObject({
  id: schemaFields.yupString().uuid().defined(),
  team_id: schemaFields.teamIdSchema.defined(),
  expires_at_millis: schemaFields.yupNumber().defined(),
  recipient_email: schemaFields.emailSchema.defined(),
}).defined();

export const teamInvitationCrud = createCrud({
  clientReadSchema: teamInvitationDetailsClientReadSchema,
  clientDeleteSchema: schemaFields.yupMixed(),
  docs: {
    clientRead: {
      summary: "Get the team details with invitation code",
      description: "",
      tags: ["Teams"],
    },
    clientList: {
      summary: "List team invitations",
      description: "",
      tags: ["Teams"],
    },
    clientDelete: {
      summary: "Delete a team invitation",
      description: "",
      tags: ["Teams"],
    },
  },
});

export type TeamInvitationCrud = CrudTypeOf<typeof teamInvitationCrud>;
