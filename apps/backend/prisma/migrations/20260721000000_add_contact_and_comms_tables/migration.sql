-- Create Contact + Comms tables and prepare ContactChannel for ownership transfer.
-- Profile fields remain on ProjectUser until a later migration drops them.
-- ContactChannel.contactId starts nullable and is backfilled before the FK is enforced.

CREATE TABLE "Contact" (
    "tenancyId" UUID NOT NULL,
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "sequenceId" BIGINT,
    "shouldUpdateSequenceId" BOOLEAN NOT NULL DEFAULT true,
    "displayName" TEXT,
    "profileImageUrl" TEXT,
    "clientMetadata" JSONB,
    "clientReadOnlyMetadata" JSONB,
    "serverMetadata" JSONB,
    "mergedIntoContactId" UUID,
    "mergedAt" TIMESTAMP(3),
    "mergeOperationId" UUID,

    CONSTRAINT "Contact_pkey" PRIMARY KEY ("tenancyId","id"),
    CONSTRAINT "Contact_sequenceId_key" UNIQUE ("sequenceId"),
    CONSTRAINT "Contact_merge_pair_check" CHECK (
      ("mergedIntoContactId" IS NULL AND "mergedAt" IS NULL)
      OR ("mergedIntoContactId" IS NOT NULL AND "mergedAt" IS NOT NULL)
    ),
    CONSTRAINT "Contact_no_self_merge_check" CHECK (
      "mergedIntoContactId" IS NULL OR "mergedIntoContactId" <> "id"
    ),
    CONSTRAINT "Contact_tenancyId_fkey" FOREIGN KEY ("tenancyId") REFERENCES "Tenancy"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

ALTER TABLE "Contact"
  ADD CONSTRAINT "Contact_mergedInto_fkey"
  FOREIGN KEY ("tenancyId","mergedIntoContactId") REFERENCES "Contact"("tenancyId","id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "ContactMergeOperation" (
    "tenancyId" UUID NOT NULL,
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sourceContactId" UUID NOT NULL,
    "targetContactId" UUID NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "actorUserId" UUID,
    "reason" TEXT,
    "metadata" JSONB,

    CONSTRAINT "ContactMergeOperation_pkey" PRIMARY KEY ("tenancyId","id"),
    CONSTRAINT "ContactMergeOperation_idempotency_key" UNIQUE ("tenancyId","idempotencyKey"),
    CONSTRAINT "ContactMergeOperation_source_target_diff" CHECK ("sourceContactId" <> "targetContactId"),
    CONSTRAINT "ContactMergeOperation_tenancyId_fkey" FOREIGN KEY ("tenancyId") REFERENCES "Tenancy"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ContactMergeOperation_source_fkey" FOREIGN KEY ("tenancyId","sourceContactId") REFERENCES "Contact"("tenancyId","id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ContactMergeOperation_target_fkey" FOREIGN KEY ("tenancyId","targetContactId") REFERENCES "Contact"("tenancyId","id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- Additive ContactChannel columns for the ownership transfer. Old projectUserId /
-- usedForAuth remain until retarget + drop migrations complete.
ALTER TABLE "ContactChannel"
  ADD COLUMN "contactId" UUID,
  ADD COLUMN "identityScope" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "data" JSONB,
  ADD COLUMN "verifiedAt" TIMESTAMP(3),
  ADD COLUMN "metadata" JSONB;

ALTER TYPE "ContactChannelType" ADD VALUE 'PHONE';
ALTER TYPE "ContactChannelType" ADD VALUE 'DISCORD';
ALTER TYPE "ContactChannelType" ADD VALUE 'SLACK';
ALTER TYPE "ContactChannelType" ADD VALUE 'PUSH';

CREATE TABLE "ProjectUserAuthContactChannel" (
    "tenancyId" UUID NOT NULL,
    "projectUserId" UUID NOT NULL,
    "contactChannelId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "type" "ContactChannelType" NOT NULL,
    "identityScope" TEXT NOT NULL DEFAULT '',
    "value" TEXT NOT NULL,

    CONSTRAINT "ProjectUserAuthContactChannel_pkey" PRIMARY KEY ("tenancyId","projectUserId","contactChannelId"),
    CONSTRAINT "ProjectUserAuthContactChannel_identity_key" UNIQUE ("tenancyId","type","identityScope","value"),
    CONSTRAINT "ProjectUserAuthContactChannel_tenancyId_fkey" FOREIGN KEY ("tenancyId") REFERENCES "Tenancy"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ProjectUserAuthContactChannel_user_fkey" FOREIGN KEY ("tenancyId","projectUserId") REFERENCES "ProjectUser"("tenancyId","projectUserId") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "CommsConversation" (
    "tenancyId" UUID NOT NULL,
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "title" TEXT,
    "mergedIntoConversationId" UUID,
    "mergedAt" TIMESTAMP(3),
    "firstMessageAt" TIMESTAMP(3),
    "lastMessageAt" TIMESTAMP(3),

    CONSTRAINT "CommsConversation_pkey" PRIMARY KEY ("tenancyId","id"),
    CONSTRAINT "CommsConversation_merge_pair_check" CHECK (
      ("mergedIntoConversationId" IS NULL AND "mergedAt" IS NULL)
      OR ("mergedIntoConversationId" IS NOT NULL AND "mergedAt" IS NOT NULL)
    ),
    CONSTRAINT "CommsConversation_no_self_merge_check" CHECK (
      "mergedIntoConversationId" IS NULL OR "mergedIntoConversationId" <> "id"
    ),
    CONSTRAINT "CommsConversation_tenancyId_fkey" FOREIGN KEY ("tenancyId") REFERENCES "Tenancy"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

ALTER TABLE "CommsConversation"
  ADD CONSTRAINT "CommsConversation_mergedInto_fkey"
  FOREIGN KEY ("tenancyId","mergedIntoConversationId") REFERENCES "CommsConversation"("tenancyId","id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "CommsMessage" (
    "tenancyId" UUID NOT NULL,
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "conversationId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "ingestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "direction" TEXT NOT NULL,
    "adapterKey" TEXT NOT NULL,
    "externalMessageId" TEXT,
    "ingestFingerprint" TEXT NOT NULL,
    "externalThreadId" TEXT,
    "replyToMessageId" UUID,
    "payloadType" TEXT NOT NULL,
    "payloadVersion" INTEGER NOT NULL,
    "payload" JSONB NOT NULL,
    "rawBlobKey" TEXT,

    CONSTRAINT "CommsMessage_pkey" PRIMARY KEY ("tenancyId","id"),
    CONSTRAINT "CommsMessage_direction_check" CHECK ("direction" IN ('inbound', 'outbound')),
    CONSTRAINT "CommsMessage_payloadType_check" CHECK ("payloadType" IN ('email', 'slack', 'discord', 'push')),
    CONSTRAINT "CommsMessage_tenancyId_fkey" FOREIGN KEY ("tenancyId") REFERENCES "Tenancy"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CommsMessage_conversation_fkey" FOREIGN KEY ("tenancyId","conversationId") REFERENCES "CommsConversation"("tenancyId","id") ON DELETE RESTRICT ON UPDATE CASCADE
);

ALTER TABLE "CommsMessage"
  ADD CONSTRAINT "CommsMessage_replyTo_fkey"
  FOREIGN KEY ("tenancyId","replyToMessageId") REFERENCES "CommsMessage"("tenancyId","id") ON DELETE SET NULL ("replyToMessageId") ON UPDATE CASCADE;

CREATE TABLE "CommsMessageParticipant" (
    "tenancyId" UUID NOT NULL,
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "messageId" UUID NOT NULL,
    "role" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "contactId" UUID,
    "contactChannelId" UUID,
    "addressSnapshot" TEXT NOT NULL,
    "displayNameSnapshot" TEXT,

    CONSTRAINT "CommsMessageParticipant_pkey" PRIMARY KEY ("tenancyId","id"),
    CONSTRAINT "CommsMessageParticipant_message_id_key" UNIQUE ("tenancyId","messageId","id"),
    CONSTRAINT "CommsMessageParticipant_role_position_key" UNIQUE ("tenancyId","messageId","role","position"),
    CONSTRAINT "CommsMessageParticipant_role_check" CHECK ("role" IN (
      'author', 'from', 'sender', 'to', 'cc', 'bcc', 'reply-to', 'envelope-from', 'envelope-to', 'audience'
    )),
    CONSTRAINT "CommsMessageParticipant_tenancyId_fkey" FOREIGN KEY ("tenancyId") REFERENCES "Tenancy"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CommsMessageParticipant_message_fkey" FOREIGN KEY ("tenancyId","messageId") REFERENCES "CommsMessage"("tenancyId","id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "CommsMessageAttachment" (
    "tenancyId" UUID NOT NULL,
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "messageId" UUID NOT NULL,
    "filename" TEXT,
    "contentType" TEXT,
    "sizeBytes" INTEGER,
    "contentId" TEXT,
    "isInline" BOOLEAN NOT NULL DEFAULT false,
    "storageKey" TEXT,
    "metadata" JSONB,

    CONSTRAINT "CommsMessageAttachment_pkey" PRIMARY KEY ("tenancyId","id"),
    CONSTRAINT "CommsMessageAttachment_tenancyId_fkey" FOREIGN KEY ("tenancyId") REFERENCES "Tenancy"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CommsMessageAttachment_message_fkey" FOREIGN KEY ("tenancyId","messageId") REFERENCES "CommsMessage"("tenancyId","id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "CommsMessageRelation" (
    "tenancyId" UUID NOT NULL,
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "fromMessageId" UUID NOT NULL,
    "toMessageId" UUID,
    "relationType" TEXT NOT NULL,
    "externalMessageId" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "CommsMessageRelation_pkey" PRIMARY KEY ("tenancyId","id"),
    CONSTRAINT "CommsMessageRelation_type_check" CHECK ("relationType" IN ('in-reply-to', 'references', 'quote', 'other')),
    CONSTRAINT "CommsMessageRelation_tenancyId_fkey" FOREIGN KEY ("tenancyId") REFERENCES "Tenancy"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CommsMessageRelation_from_fkey" FOREIGN KEY ("tenancyId","fromMessageId") REFERENCES "CommsMessage"("tenancyId","id") ON DELETE CASCADE ON UPDATE CASCADE
);

ALTER TABLE "CommsMessageRelation"
  ADD CONSTRAINT "CommsMessageRelation_to_fkey"
  FOREIGN KEY ("tenancyId","toMessageId") REFERENCES "CommsMessage"("tenancyId","id") ON DELETE SET NULL ("toMessageId") ON UPDATE CASCADE;

CREATE TABLE "CommsConversationOperation" (
    "tenancyId" UUID NOT NULL,
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "operationType" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "sourceConversationId" UUID,
    "targetConversationId" UUID,
    "actorUserId" UUID,
    "reason" TEXT,
    "metadata" JSONB,

    CONSTRAINT "CommsConversationOperation_pkey" PRIMARY KEY ("tenancyId","id"),
    CONSTRAINT "CommsConversationOperation_idempotency_key" UNIQUE ("tenancyId","idempotencyKey"),
    CONSTRAINT "CommsConversationOperation_type_check" CHECK ("operationType" IN ('merge', 'split', 'reassign')),
    CONSTRAINT "CommsConversationOperation_tenancyId_fkey" FOREIGN KEY ("tenancyId") REFERENCES "Tenancy"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

ALTER TABLE "CommsConversationOperation"
  ADD CONSTRAINT "CommsConversationOperation_source_fkey"
  FOREIGN KEY ("tenancyId","sourceConversationId") REFERENCES "CommsConversation"("tenancyId","id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "CommsConversationOperation_target_fkey"
  FOREIGN KEY ("tenancyId","targetConversationId") REFERENCES "CommsConversation"("tenancyId","id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "CommsMessageAssignment" (
    "tenancyId" UUID NOT NULL,
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "messageId" UUID NOT NULL,
    "operationId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fromConversationId" UUID,
    "toConversationId" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION,

    CONSTRAINT "CommsMessageAssignment_pkey" PRIMARY KEY ("tenancyId","id"),
    CONSTRAINT "CommsMessageAssignment_operation_message_key" UNIQUE ("tenancyId","operationId","messageId"),
    CONSTRAINT "CommsMessageAssignment_reason_check" CHECK ("reason" IN (
      'reply', 'external-thread', 'rules', 'ai', 'manual', 'merge', 'split'
    )),
    CONSTRAINT "CommsMessageAssignment_tenancyId_fkey" FOREIGN KEY ("tenancyId") REFERENCES "Tenancy"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CommsMessageAssignment_message_fkey" FOREIGN KEY ("tenancyId","messageId") REFERENCES "CommsMessage"("tenancyId","id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CommsMessageAssignment_operation_fkey" FOREIGN KEY ("tenancyId","operationId") REFERENCES "CommsConversationOperation"("tenancyId","id") ON DELETE CASCADE ON UPDATE CASCADE
);

ALTER TABLE "CommsMessageAssignment"
  ADD CONSTRAINT "CommsMessageAssignment_from_fkey"
  FOREIGN KEY ("tenancyId","fromConversationId") REFERENCES "CommsConversation"("tenancyId","id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "CommsMessageAssignment_to_fkey"
  FOREIGN KEY ("tenancyId","toConversationId") REFERENCES "CommsConversation"("tenancyId","id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "CommsDelivery" (
    "tenancyId" UUID NOT NULL,
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "messageId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "participantId" UUID,
    "addressSnapshot" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "providerMessageId" TEXT,
    "skippedReason" TEXT,
    "lastErrorPublic" TEXT,
    "lastErrorInternal" TEXT,
    "sentAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "bouncedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),

    CONSTRAINT "CommsDelivery_pkey" PRIMARY KEY ("tenancyId","id"),
    CONSTRAINT "CommsDelivery_status_check" CHECK ("status" IN (
      'pending', 'queued', 'sending', 'sent', 'delivered', 'delayed', 'bounced', 'failed', 'skipped'
    )),
    CONSTRAINT "CommsDelivery_tenancyId_fkey" FOREIGN KEY ("tenancyId") REFERENCES "Tenancy"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CommsDelivery_message_fkey" FOREIGN KEY ("tenancyId","messageId") REFERENCES "CommsMessage"("tenancyId","id") ON DELETE CASCADE ON UPDATE CASCADE
);

ALTER TABLE "CommsDelivery"
  ADD CONSTRAINT "CommsDelivery_participant_fkey"
  FOREIGN KEY ("tenancyId","messageId","participantId")
  REFERENCES "CommsMessageParticipant"("tenancyId","messageId","id")
  ON DELETE NO ACTION ON UPDATE CASCADE
  DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE "CommsDeliveryAttempt" (
    "tenancyId" UUID NOT NULL,
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "deliveryId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attemptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "attemptNumber" INTEGER NOT NULL,
    "outcome" TEXT NOT NULL,
    "providerResponse" JSONB,
    "errorPublic" TEXT,
    "errorInternal" TEXT,

    CONSTRAINT "CommsDeliveryAttempt_pkey" PRIMARY KEY ("tenancyId","id"),
    CONSTRAINT "CommsDeliveryAttempt_delivery_attempt_key" UNIQUE ("tenancyId","deliveryId","attemptNumber"),
    CONSTRAINT "CommsDeliveryAttempt_outcome_check" CHECK ("outcome" IN ('success', 'failure', 'deferred')),
    CONSTRAINT "CommsDeliveryAttempt_tenancyId_fkey" FOREIGN KEY ("tenancyId") REFERENCES "Tenancy"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CommsDeliveryAttempt_delivery_fkey" FOREIGN KEY ("tenancyId","deliveryId") REFERENCES "CommsDelivery"("tenancyId","id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "Contact_displayName_asc" ON "Contact"("tenancyId", "displayName" ASC);
CREATE INDEX "Contact_displayName_desc" ON "Contact"("tenancyId", "displayName" DESC);
CREATE INDEX "Contact_mergedIntoContactId_idx" ON "Contact"("tenancyId", "mergedIntoContactId");
CREATE INDEX "Contact_tenancyId_sequenceId_idx" ON "Contact"("tenancyId", "sequenceId");
CREATE INDEX "Contact_shouldUpdateSequenceId_idx" ON "Contact"("shouldUpdateSequenceId", "tenancyId");
CREATE INDEX "ContactMergeOperation_source_idx" ON "ContactMergeOperation"("tenancyId", "sourceContactId");
CREATE INDEX "ContactMergeOperation_target_idx" ON "ContactMergeOperation"("tenancyId", "targetContactId");
CREATE INDEX "ProjectUserAuthContactChannel_tenancyId_contactChannelId_idx"
  ON "ProjectUserAuthContactChannel"("tenancyId", "contactChannelId");

CREATE INDEX "CommsConversation_lastMessageAt_idx" ON "CommsConversation"("tenancyId", "lastMessageAt" DESC NULLS LAST, "id" DESC);
CREATE INDEX "CommsConversation_mergedInto_idx" ON "CommsConversation"("tenancyId", "mergedIntoConversationId");
CREATE INDEX "CommsMessage_global_timeline_idx" ON "CommsMessage"("tenancyId", "occurredAt", "id");
CREATE INDEX "CommsMessage_conversation_timeline_idx" ON "CommsMessage"("tenancyId", "conversationId", "occurredAt", "id");
CREATE INDEX "CommsMessage_external_id_idx" ON "CommsMessage"("tenancyId", "adapterKey", "externalMessageId");
CREATE INDEX "CommsMessage_external_thread_idx" ON "CommsMessage"("tenancyId", "externalThreadId");
CREATE INDEX "CommsMessage_replyTo_idx" ON "CommsMessage"("tenancyId", "replyToMessageId");
CREATE INDEX "CommsMessageParticipant_contact_idx" ON "CommsMessageParticipant"("tenancyId", "contactId");
CREATE INDEX "CommsMessageParticipant_channel_idx" ON "CommsMessageParticipant"("tenancyId", "contactChannelId");
CREATE INDEX "CommsMessageAttachment_message_idx" ON "CommsMessageAttachment"("tenancyId", "messageId");
CREATE INDEX "CommsMessageRelation_from_idx" ON "CommsMessageRelation"("tenancyId", "fromMessageId");
CREATE INDEX "CommsMessageRelation_to_idx" ON "CommsMessageRelation"("tenancyId", "toMessageId");
CREATE INDEX "CommsMessageRelation_external_idx" ON "CommsMessageRelation"("tenancyId", "externalMessageId");
CREATE INDEX "CommsMessageAssignment_message_idx" ON "CommsMessageAssignment"("tenancyId", "messageId", "createdAt");
CREATE INDEX "CommsDelivery_message_idx" ON "CommsDelivery"("tenancyId", "messageId");
CREATE INDEX "CommsDelivery_status_idx" ON "CommsDelivery"("tenancyId", "status");
CREATE INDEX "CommsDeliveryAttempt_delivery_idx" ON "CommsDeliveryAttempt"("tenancyId", "deliveryId", "attemptedAt");

CREATE UNIQUE INDEX "CommsMessage_external_id_unique"
  ON "CommsMessage"("tenancyId", "adapterKey", "externalMessageId")
  WHERE "externalMessageId" IS NOT NULL;

-- Keep legacy ProjectUser profile columns synchronized during rolling deploys.
-- Old application instances create Contact rows; new instances mirror Contact
-- updates back so rollback remains possible while the columns are retained.
-- SPLIT_STATEMENT_SENTINEL
-- SINGLE_STATEMENT_SENTINEL
CREATE OR REPLACE FUNCTION "ProjectUser_sync_contact_profile"()
RETURNS trigger AS $$
BEGIN
  IF pg_trigger_depth() > 1 THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW."temp_contact_backfilled" := TRUE;
  END IF;

  IF TG_OP = 'INSERT' AND EXISTS (
    SELECT 1
    FROM "Contact" c
    WHERE c."tenancyId" = NEW."tenancyId"
      AND c."id" = NEW."projectUserId"
  ) THEN
    SELECT
      c."displayName",
      c."profileImageUrl",
      c."clientMetadata",
      c."clientReadOnlyMetadata",
      c."serverMetadata"
    INTO
      NEW."displayName",
      NEW."profileImageUrl",
      NEW."clientMetadata",
      NEW."clientReadOnlyMetadata",
      NEW."serverMetadata"
    FROM "Contact" c
    WHERE c."tenancyId" = NEW."tenancyId"
      AND c."id" = NEW."projectUserId";
    RETURN NEW;
  END IF;

  INSERT INTO "Contact" (
    "tenancyId",
    "id",
    "createdAt",
    "updatedAt",
    "displayName",
    "profileImageUrl",
    "clientMetadata",
    "clientReadOnlyMetadata",
    "serverMetadata",
    "shouldUpdateSequenceId"
  )
  VALUES (
    NEW."tenancyId",
    NEW."projectUserId",
    NEW."createdAt",
    NEW."updatedAt",
    NEW."displayName",
    NEW."profileImageUrl",
    NEW."clientMetadata",
    NEW."clientReadOnlyMetadata",
    NEW."serverMetadata",
    TRUE
  )
  ON CONFLICT ("tenancyId", "id") DO UPDATE SET
    "displayName" = EXCLUDED."displayName",
    "profileImageUrl" = EXCLUDED."profileImageUrl",
    "clientMetadata" = EXCLUDED."clientMetadata",
    "clientReadOnlyMetadata" = EXCLUDED."clientReadOnlyMetadata",
    "serverMetadata" = EXCLUDED."serverMetadata",
    "updatedAt" = EXCLUDED."updatedAt",
    "shouldUpdateSequenceId" = TRUE;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
-- SPLIT_STATEMENT_SENTINEL
-- SINGLE_STATEMENT_SENTINEL
CREATE OR REPLACE FUNCTION "Contact_sync_legacy_project_user_profile"()
RETURNS trigger AS $$
BEGIN
  IF pg_trigger_depth() > 1 THEN
    RETURN NEW;
  END IF;

  UPDATE "ProjectUser"
  SET
    "displayName" = NEW."displayName",
    "profileImageUrl" = NEW."profileImageUrl",
    "clientMetadata" = NEW."clientMetadata",
    "clientReadOnlyMetadata" = NEW."clientReadOnlyMetadata",
    "serverMetadata" = NEW."serverMetadata",
    "updatedAt" = NEW."updatedAt",
    "shouldUpdateSequenceId" = TRUE
  WHERE "tenancyId" = NEW."tenancyId"
    AND "projectUserId" = NEW."id";

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
-- SPLIT_STATEMENT_SENTINEL

DROP TRIGGER IF EXISTS "ProjectUser_sync_contact_profile_insert_trg" ON "ProjectUser";
CREATE TRIGGER "ProjectUser_sync_contact_profile_insert_trg"
  BEFORE INSERT ON "ProjectUser"
  FOR EACH ROW
  EXECUTE FUNCTION "ProjectUser_sync_contact_profile"();

DROP TRIGGER IF EXISTS "ProjectUser_sync_contact_profile_update_trg" ON "ProjectUser";
CREATE TRIGGER "ProjectUser_sync_contact_profile_update_trg"
  BEFORE UPDATE OF
    "displayName",
    "profileImageUrl",
    "clientMetadata",
    "clientReadOnlyMetadata",
    "serverMetadata"
  ON "ProjectUser"
  FOR EACH ROW
  EXECUTE FUNCTION "ProjectUser_sync_contact_profile"();

DROP TRIGGER IF EXISTS "Contact_sync_legacy_project_user_profile_trg" ON "Contact";
CREATE TRIGGER "Contact_sync_legacy_project_user_profile_trg"
  AFTER UPDATE OF
    "displayName",
    "profileImageUrl",
    "clientMetadata",
    "clientReadOnlyMetadata",
    "serverMetadata"
  ON "Contact"
  FOR EACH ROW
  EXECUTE FUNCTION "Contact_sync_legacy_project_user_profile"();

-- Keep old and new ContactChannel ownership/auth representations compatible.
-- SPLIT_STATEMENT_SENTINEL
-- SINGLE_STATEMENT_SENTINEL
CREATE OR REPLACE FUNCTION "ContactChannel_sync_legacy_owner"()
RETURNS trigger AS $$
BEGIN
  IF NEW."contactId" IS NOT NULL
    AND NEW."projectUserId" IS NOT NULL
    AND NEW."contactId" <> NEW."projectUserId" THEN
    RAISE EXCEPTION 'ContactChannel contactId and projectUserId must identify the same user-backed contact'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW."contactId" IS NULL THEN
    NEW."contactId" := NEW."projectUserId";
  END IF;

  IF NEW."projectUserId" IS NULL THEN
    SELECT pu."projectUserId"
    INTO NEW."projectUserId"
    FROM "ProjectUser" pu
    WHERE pu."tenancyId" = NEW."tenancyId"
      AND pu."projectUserId" = NEW."contactId";
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
-- SPLIT_STATEMENT_SENTINEL
-- SINGLE_STATEMENT_SENTINEL
CREATE OR REPLACE FUNCTION "ContactChannel_sync_auth_selection"()
RETURNS trigger AS $$
BEGIN
  IF pg_trigger_depth() > 1 OR NEW."projectUserId" IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW."usedForAuth" = 'TRUE' THEN
    INSERT INTO "ProjectUserAuthContactChannel" (
      "tenancyId",
      "projectUserId",
      "contactChannelId",
      "createdAt",
      "updatedAt",
      "type",
      "identityScope",
      "value"
    )
    VALUES (
      NEW."tenancyId",
      NEW."projectUserId",
      NEW."id",
      NOW(),
      NOW(),
      NEW."type",
      NEW."identityScope",
      NEW."value"
    )
    ON CONFLICT ("tenancyId", "projectUserId", "contactChannelId") DO UPDATE SET
      "updatedAt" = NOW(),
      "type" = EXCLUDED."type",
      "identityScope" = EXCLUDED."identityScope",
      "value" = EXCLUDED."value";
  ELSE
    DELETE FROM "ProjectUserAuthContactChannel"
    WHERE "tenancyId" = NEW."tenancyId"
      AND "projectUserId" = NEW."projectUserId"
      AND "contactChannelId" = NEW."id";
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
-- SPLIT_STATEMENT_SENTINEL
-- SINGLE_STATEMENT_SENTINEL
CREATE OR REPLACE FUNCTION "ProjectUserAuthContactChannel_sync_legacy_flag"()
RETURNS trigger AS $$
BEGIN
  IF pg_trigger_depth() > 1 THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    UPDATE "ContactChannel"
    SET
      "usedForAuth" = NULL,
      "shouldUpdateSequenceId" = TRUE
    WHERE "tenancyId" = OLD."tenancyId"
      AND "id" = OLD."contactChannelId";
    RETURN OLD;
  END IF;

  UPDATE "ContactChannel"
  SET
    "usedForAuth" = 'TRUE',
    "shouldUpdateSequenceId" = TRUE
  WHERE "tenancyId" = NEW."tenancyId"
    AND "id" = NEW."contactChannelId";
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
-- SPLIT_STATEMENT_SENTINEL
-- SINGLE_STATEMENT_SENTINEL
CREATE OR REPLACE FUNCTION "ContactChannel_cleanup_auth_selection"()
RETURNS trigger AS $$
BEGIN
  DELETE FROM "ProjectUserAuthContactChannel"
  WHERE "tenancyId" = OLD."tenancyId"
    AND "contactChannelId" = OLD."id";
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;
-- SPLIT_STATEMENT_SENTINEL

-- A CRM contact may acquire a ProjectUser after its channels were created.
-- Populate the legacy owner and re-sequence those channels only after the user
-- row exists, keeping both old application instances and external DB sync valid.
-- SINGLE_STATEMENT_SENTINEL
CREATE OR REPLACE FUNCTION "ProjectUser_sync_existing_contact_channels"()
RETURNS trigger AS $$
BEGIN
  UPDATE "ContactChannel"
  SET
    "projectUserId" = NEW."projectUserId",
    "shouldUpdateSequenceId" = TRUE
  WHERE "tenancyId" = NEW."tenancyId"
    AND "contactId" = NEW."projectUserId";
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
-- SPLIT_STATEMENT_SENTINEL

DROP TRIGGER IF EXISTS "ProjectUser_sync_existing_contact_channels_trg" ON "ProjectUser";
CREATE TRIGGER "ProjectUser_sync_existing_contact_channels_trg"
  AFTER INSERT ON "ProjectUser"
  FOR EACH ROW
  EXECUTE FUNCTION "ProjectUser_sync_existing_contact_channels"();

DROP TRIGGER IF EXISTS "ContactChannel_sync_legacy_owner_trg" ON "ContactChannel";
CREATE TRIGGER "ContactChannel_sync_legacy_owner_trg"
  BEFORE INSERT OR UPDATE OF "contactId", "projectUserId"
  ON "ContactChannel"
  FOR EACH ROW
  EXECUTE FUNCTION "ContactChannel_sync_legacy_owner"();

DROP TRIGGER IF EXISTS "ContactChannel_sync_auth_selection_trg" ON "ContactChannel";
CREATE TRIGGER "ContactChannel_sync_auth_selection_trg"
  AFTER INSERT OR UPDATE OF "usedForAuth", "type", "identityScope", "value"
  ON "ContactChannel"
  FOR EACH ROW
  EXECUTE FUNCTION "ContactChannel_sync_auth_selection"();

DROP TRIGGER IF EXISTS "ContactChannel_cleanup_auth_selection_trg" ON "ContactChannel";
CREATE TRIGGER "ContactChannel_cleanup_auth_selection_trg"
  AFTER DELETE ON "ContactChannel"
  FOR EACH ROW
  EXECUTE FUNCTION "ContactChannel_cleanup_auth_selection"();

DROP TRIGGER IF EXISTS "ProjectUserAuthContactChannel_sync_legacy_flag_insert_trg" ON "ProjectUserAuthContactChannel";
CREATE TRIGGER "ProjectUserAuthContactChannel_sync_legacy_flag_insert_trg"
  AFTER INSERT ON "ProjectUserAuthContactChannel"
  FOR EACH ROW
  EXECUTE FUNCTION "ProjectUserAuthContactChannel_sync_legacy_flag"();

DROP TRIGGER IF EXISTS "ProjectUserAuthContactChannel_sync_legacy_flag_delete_trg" ON "ProjectUserAuthContactChannel";
CREATE TRIGGER "ProjectUserAuthContactChannel_sync_legacy_flag_delete_trg"
  AFTER DELETE ON "ProjectUserAuthContactChannel"
  FOR EACH ROW
  EXECUTE FUNCTION "ProjectUserAuthContactChannel_sync_legacy_flag"();
