-- Switch the primary key using the prebuilt index, then allow standalone
-- Contacts to own channels while retaining nullable legacy ownership.
ALTER TABLE "ContactChannel"
  DROP CONSTRAINT "ContactChannel_tenancyId_projectUserId_fkey";
ALTER TABLE "ContactChannel" DROP CONSTRAINT "ContactChannel_pkey";
ALTER TABLE "ContactChannel"
  ADD CONSTRAINT "ContactChannel_pkey"
  PRIMARY KEY USING INDEX "ContactChannel_tenancyId_id_key_for_pk";
ALTER TABLE "ContactChannel" ALTER COLUMN "projectUserId" DROP NOT NULL;

ALTER TABLE "ContactChannel"
  ADD CONSTRAINT "ContactChannel_legacy_project_user_fkey"
  FOREIGN KEY ("tenancyId", "projectUserId") REFERENCES "ProjectUser"("tenancyId", "projectUserId")
  ON DELETE SET NULL ("projectUserId") ON UPDATE CASCADE NOT VALID,
  ADD CONSTRAINT "ContactChannel_contactId_not_null"
  CHECK ("contactId" IS NOT NULL) NOT VALID,
  ADD CONSTRAINT "ContactChannel_contact_fkey"
  FOREIGN KEY ("tenancyId", "contactId") REFERENCES "Contact"("tenancyId", "id")
  ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;

ALTER TABLE "ProjectUserAuthContactChannel"
  ADD CONSTRAINT "ProjectUserAuthContactChannel_channel_fkey"
  FOREIGN KEY ("tenancyId", "contactChannelId") REFERENCES "ContactChannel"("tenancyId", "id")
  ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;

ALTER TABLE "CommsMessageParticipant"
  ADD CONSTRAINT "CommsMessageParticipant_contact_fkey"
  FOREIGN KEY ("tenancyId", "contactId") REFERENCES "Contact"("tenancyId", "id")
  ON DELETE SET NULL ("contactId") ON UPDATE CASCADE NOT VALID,
  ADD CONSTRAINT "CommsMessageParticipant_channel_fkey"
  FOREIGN KEY ("tenancyId", "contactChannelId") REFERENCES "ContactChannel"("tenancyId", "id")
  ON DELETE SET NULL ("contactChannelId") ON UPDATE CASCADE NOT VALID;

ALTER TABLE "ProjectUser"
  ADD CONSTRAINT "ProjectUser_contact_fkey"
  FOREIGN KEY ("tenancyId", "projectUserId") REFERENCES "Contact"("tenancyId", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE
  NOT VALID;

-- Reject merging a user-backed contact (source has a ProjectUser with the same UUID).
-- SPLIT_STATEMENT_SENTINEL
-- SINGLE_STATEMENT_SENTINEL
CREATE OR REPLACE FUNCTION "Contact_reject_user_backed_merge"()
RETURNS trigger AS $$
BEGIN
  IF NEW."mergedIntoContactId" IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM "ProjectUser" pu
      WHERE pu."tenancyId" = NEW."tenancyId"
        AND pu."projectUserId" = NEW."id"
    ) THEN
      RAISE EXCEPTION 'Cannot merge a user-backed contact (tenancyId=%, contactId=%)', NEW."tenancyId", NEW."id"
        USING ERRCODE = 'check_violation';
    END IF;

    -- Reject merge chains: target must be canonical (not already merged).
    IF EXISTS (
      SELECT 1 FROM "Contact" c
      WHERE c."tenancyId" = NEW."tenancyId"
        AND c."id" = NEW."mergedIntoContactId"
        AND c."mergedIntoContactId" IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'Cannot merge into a non-canonical contact (tenancyId=%, targetId=%)', NEW."tenancyId", NEW."mergedIntoContactId"
        USING ERRCODE = 'check_violation';
    END IF;

    -- A canonical target with merged aliases cannot itself become an alias;
    -- otherwise lookups would need to follow an unbounded merge chain.
    IF EXISTS (
      SELECT 1 FROM "Contact" c
      WHERE c."tenancyId" = NEW."tenancyId"
        AND c."mergedIntoContactId" = NEW."id"
    ) THEN
      RAISE EXCEPTION 'Cannot merge a contact that already has merged source contacts'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
-- SPLIT_STATEMENT_SENTINEL

DROP TRIGGER IF EXISTS "Contact_reject_user_backed_merge_trg" ON "Contact";
CREATE TRIGGER "Contact_reject_user_backed_merge_trg"
  BEFORE UPDATE OF "mergedIntoContactId", "mergedAt" ON "Contact"
  FOR EACH ROW
  EXECUTE FUNCTION "Contact_reject_user_backed_merge"();

-- Keep conversation redirects one hop deep even for direct SQL writers.
-- SPLIT_STATEMENT_SENTINEL
-- SINGLE_STATEMENT_SENTINEL
CREATE OR REPLACE FUNCTION "CommsConversation_reject_merge_chain"()
RETURNS trigger AS $$
BEGIN
  IF NEW."mergedIntoConversationId" IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM "CommsConversation" c
      WHERE c."tenancyId" = NEW."tenancyId"
        AND c."id" = NEW."mergedIntoConversationId"
        AND c."mergedIntoConversationId" IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'Cannot merge into a non-canonical conversation'
        USING ERRCODE = 'check_violation';
    END IF;

    IF EXISTS (
      SELECT 1 FROM "CommsConversation" c
      WHERE c."tenancyId" = NEW."tenancyId"
        AND c."mergedIntoConversationId" = NEW."id"
    ) THEN
      RAISE EXCEPTION 'Cannot merge a conversation that already has merged source conversations'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
-- SPLIT_STATEMENT_SENTINEL

DROP TRIGGER IF EXISTS "CommsConversation_reject_merge_chain_trg" ON "CommsConversation";
CREATE TRIGGER "CommsConversation_reject_merge_chain_trg"
  BEFORE UPDATE OF "mergedIntoConversationId", "mergedAt" ON "CommsConversation"
  FOR EACH ROW
  EXECUTE FUNCTION "CommsConversation_reject_merge_chain"();

-- Authentication selections duplicate identity columns for uniqueness. Keep
-- those values and ownership tied to the selected channel for direct SQL too.
-- SPLIT_STATEMENT_SENTINEL
-- SINGLE_STATEMENT_SENTINEL
CREATE OR REPLACE FUNCTION "ProjectUserAuthContactChannel_enforce_channel"()
RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "ContactChannel" cc
    WHERE cc."tenancyId" = NEW."tenancyId"
      AND cc."id" = NEW."contactChannelId"
      AND cc."contactId" = NEW."projectUserId"
      AND cc."type" = NEW."type"
      AND cc."identityScope" = NEW."identityScope"
      AND cc."value" = NEW."value"
  ) THEN
    RAISE EXCEPTION 'Auth selection must match its user-owned contact channel'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
-- SPLIT_STATEMENT_SENTINEL

DROP TRIGGER IF EXISTS "ProjectUserAuthContactChannel_enforce_channel_trg" ON "ProjectUserAuthContactChannel";
CREATE TRIGGER "ProjectUserAuthContactChannel_enforce_channel_trg"
  BEFORE INSERT OR UPDATE OF "projectUserId", "contactChannelId", "type", "identityScope", "value"
  ON "ProjectUserAuthContactChannel"
  FOR EACH ROW
  EXECUTE FUNCTION "ProjectUserAuthContactChannel_enforce_channel"();

-- If both optional participant references exist, they must identify the same
-- owner. Channel-only writes inherit the owner automatically.
-- SPLIT_STATEMENT_SENTINEL
-- SINGLE_STATEMENT_SENTINEL
CREATE OR REPLACE FUNCTION "CommsMessageParticipant_enforce_channel_owner"()
RETURNS trigger AS $$
DECLARE
  channel_contact_id UUID;
BEGIN
  -- Referential-action updates may temporarily clear one side before the
  -- related cascade clears the other. Let PostgreSQL complete that operation.
  IF pg_trigger_depth() > 1 THEN
    RETURN NEW;
  END IF;

  IF NEW."contactChannelId" IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT cc."contactId"
  INTO channel_contact_id
  FROM "ContactChannel" cc
  WHERE cc."tenancyId" = NEW."tenancyId"
    AND cc."id" = NEW."contactChannelId";

  IF channel_contact_id IS NOT NULL AND NEW."contactId" IS NULL THEN
    NEW."contactId" := channel_contact_id;
  ELSIF channel_contact_id IS NOT NULL AND NEW."contactId" <> channel_contact_id THEN
    RAISE EXCEPTION 'Message participant contact and channel owner must match'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
-- SPLIT_STATEMENT_SENTINEL

DROP TRIGGER IF EXISTS "CommsMessageParticipant_enforce_channel_owner_trg" ON "CommsMessageParticipant";
CREATE TRIGGER "CommsMessageParticipant_enforce_channel_owner_trg"
  BEFORE INSERT OR UPDATE OF "contactId", "contactChannelId"
  ON "CommsMessageParticipant"
  FOR EACH ROW
  EXECUTE FUNCTION "CommsMessageParticipant_enforce_channel_owner"();
