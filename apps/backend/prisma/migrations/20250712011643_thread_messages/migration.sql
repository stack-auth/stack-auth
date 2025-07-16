-- CreateEnum
CREATE TYPE "ThreadMessageRole" AS ENUM ('user', 'assistant', 'tool');

-- CreateTable
CREATE TABLE "ThreadMessage" (
    "id" UUID NOT NULL,
    "tenancyId" UUID NOT NULL,
    "threadId" UUID NOT NULL,
    "role" "ThreadMessageRole" NOT NULL,
    "content" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ThreadMessage_pkey" PRIMARY KEY ("tenancyId","id")
);
