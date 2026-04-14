-- CreateTable
CREATE TABLE "AiConversation" (
    "id" UUID NOT NULL,
    "projectUserId" UUID NOT NULL,
    "projectId" TEXT NOT NULL REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "title" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiMessage" (
    "id" UUID NOT NULL,
    "conversationId" UUID NOT NULL REFERENCES "AiConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "position" INTEGER NOT NULL,
    "role" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiConversation_projectUserId_projectId_updatedAt_idx" ON "AiConversation"("projectUserId", "projectId", "updatedAt" DESC);

-- CreateIndex
CREATE INDEX "AiMessage_conversationId_position_idx" ON "AiMessage"("conversationId", "position" ASC);
