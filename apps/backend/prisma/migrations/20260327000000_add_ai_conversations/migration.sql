-- CreateTable
CREATE TABLE "AiConversation" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "projectUserId" UUID NOT NULL,
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiMessage" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "conversationId" UUID NOT NULL,
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

-- AddForeignKey
ALTER TABLE "AiConversation" ADD CONSTRAINT "AiConversation_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiMessage" ADD CONSTRAINT "AiMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "AiConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
