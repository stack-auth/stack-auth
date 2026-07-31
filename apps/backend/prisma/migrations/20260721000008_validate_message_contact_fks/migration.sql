-- CommsMessageParticipant is new and normally empty at this point. Its two
-- validations share a migration because neither scans a pre-existing table.
ALTER TABLE "CommsMessageParticipant"
  VALIDATE CONSTRAINT "CommsMessageParticipant_contact_fkey";
ALTER TABLE "CommsMessageParticipant"
  VALIDATE CONSTRAINT "CommsMessageParticipant_channel_fkey";
