import { globalPrismaClient } from "@/prisma-client";
import { StatusError } from "@stackframe/stack-shared/dist/utils/errors";

export async function getOwnedConversation(conversationId: string, userId: string) {
  const conversation = await globalPrismaClient.aiConversation.findUnique({
    where: { id: conversationId },
  });
  if (!conversation || conversation.projectUserId !== userId) {
    throw new StatusError(StatusError.NotFound, "Conversation not found");
  }
  return conversation;
}
