CREATE TABLE "Conversation" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenancyId" UUID NOT NULL,
    "projectUserId" UUID,
    "teamId" UUID,
    "subject" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "priority" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastInboundAt" TIMESTAMP(3),
    "lastOutboundAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("tenancyId","id"),
    CONSTRAINT "Conversation_status_check" CHECK ("status" IN ('open', 'pending', 'closed')),
    CONSTRAINT "Conversation_priority_check" CHECK ("priority" IN ('low', 'normal', 'high', 'urgent')),
    CONSTRAINT "Conversation_source_check" CHECK ("source" IN ('manual', 'chat', 'email', 'api')),
    CONSTRAINT "Conversation_tenancyId_fkey" FOREIGN KEY ("tenancyId") REFERENCES "Tenancy"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Conversation_projectUser_fkey" FOREIGN KEY ("tenancyId", "projectUserId") REFERENCES "ProjectUser"("tenancyId", "projectUserId") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Conversation_team_fkey" FOREIGN KEY ("tenancyId", "teamId") REFERENCES "Team"("tenancyId", "teamId") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "ConversationMetadata" (
    "conversationId" UUID NOT NULL,
    "tenancyId" UUID NOT NULL,
    "assignedToUserId" TEXT,
    "assignedToDisplayName" TEXT,
    "tags" JSONB,
    "firstResponseDueAt" TIMESTAMP(3),
    "firstResponseAt" TIMESTAMP(3),
    "nextResponseDueAt" TIMESTAMP(3),
    "lastCustomerReplyAt" TIMESTAMP(3),
    "lastAgentReplyAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConversationMetadata_pkey" PRIMARY KEY ("tenancyId","conversationId"),
    CONSTRAINT "ConversationMetadata_tenancyId_fkey" FOREIGN KEY ("tenancyId") REFERENCES "Tenancy"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ConversationMetadata_conversation_fkey" FOREIGN KEY ("tenancyId", "conversationId") REFERENCES "Conversation"("tenancyId", "id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "ConversationChannel" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenancyId" UUID NOT NULL,
    "conversationId" UUID NOT NULL,
    "channelType" TEXT NOT NULL,
    "adapterKey" TEXT NOT NULL,
    "externalChannelId" TEXT,
    "isEntryPoint" BOOLEAN NOT NULL DEFAULT FALSE,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConversationChannel_pkey" PRIMARY KEY ("tenancyId","id"),
    CONSTRAINT "ConversationChannel_type_check" CHECK ("channelType" IN ('manual', 'chat', 'email', 'api')),
    CONSTRAINT "ConversationChannel_tenancyId_fkey" FOREIGN KEY ("tenancyId") REFERENCES "Tenancy"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ConversationChannel_conversation_fkey" FOREIGN KEY ("tenancyId", "conversationId") REFERENCES "Conversation"("tenancyId", "id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "ConversationMessage" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenancyId" UUID NOT NULL,
    "conversationId" UUID NOT NULL,
    "channelId" UUID,
    "messageType" TEXT NOT NULL,
    "senderType" TEXT NOT NULL,
    "senderId" TEXT,
    "senderDisplayName" TEXT,
    "senderPrimaryEmail" TEXT,
    "body" TEXT,
    "attachments" JSONB,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConversationMessage_pkey" PRIMARY KEY ("tenancyId","id"),
    CONSTRAINT "ConversationMessage_messageType_check" CHECK ("messageType" IN ('message', 'internal-note', 'status-change')),
    CONSTRAINT "ConversationMessage_senderType_check" CHECK ("senderType" IN ('user', 'agent', 'system')),
    CONSTRAINT "ConversationMessage_tenancyId_fkey" FOREIGN KEY ("tenancyId") REFERENCES "Tenancy"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ConversationMessage_conversation_fkey" FOREIGN KEY ("tenancyId", "conversationId") REFERENCES "Conversation"("tenancyId", "id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ConversationMessage_channel_fkey" FOREIGN KEY ("tenancyId", "channelId") REFERENCES "ConversationChannel"("tenancyId", "id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "Conversation_user_lastMessageAt_idx" ON "Conversation"("tenancyId", "projectUserId", "lastMessageAt" DESC);
CREATE INDEX "Conversation_status_lastMessageAt_idx" ON "Conversation"("tenancyId", "status", "lastMessageAt" DESC);
CREATE INDEX "Conversation_team_lastMessageAt_idx" ON "Conversation"("tenancyId", "teamId", "lastMessageAt" DESC);
CREATE INDEX "ConversationChannel_conversation_createdAt_idx" ON "ConversationChannel"("tenancyId", "conversationId", "createdAt");
CREATE INDEX "ConversationChannel_type_adapter_idx" ON "ConversationChannel"("tenancyId", "channelType", "adapterKey");
CREATE INDEX "ConversationMessage_conversation_createdAt_idx" ON "ConversationMessage"("tenancyId", "conversationId", "createdAt");
CREATE INDEX "ConversationMessage_channel_createdAt_idx" ON "ConversationMessage"("tenancyId", "channelId", "createdAt");
