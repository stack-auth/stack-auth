ALTER TABLE "Conversation" DROP CONSTRAINT "Conversation_projectUser_fkey";
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_projectUser_fkey"
  FOREIGN KEY ("tenancyId", "projectUserId")
  REFERENCES "ProjectUser"("tenancyId", "projectUserId")
  ON DELETE SET NULL ("projectUserId")
  ON UPDATE CASCADE;

ALTER TABLE "Conversation" DROP CONSTRAINT "Conversation_team_fkey";
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_team_fkey"
  FOREIGN KEY ("tenancyId", "teamId")
  REFERENCES "Team"("tenancyId", "teamId")
  ON DELETE SET NULL ("teamId")
  ON UPDATE CASCADE;
