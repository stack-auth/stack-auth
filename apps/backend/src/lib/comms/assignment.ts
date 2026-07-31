import type { PrismaTransaction } from "@/lib/types";
import type { CommsAssignmentReason } from "@hexclave/shared/dist/interface/comms";
import { StatusError } from "@hexclave/shared/dist/utils/errors";

export type ConversationChoice =
  | {
    conversationId: string,
    reason: Extract<CommsAssignmentReason, "reply" | "external-thread" | "rules" | "ai" | "manual">,
    confidence: number | null,
    created: false,
  }
  | {
    conversationId: null,
    reason: null,
    confidence: null,
    created: true,
  };

/**
 * AI-assisted conversation grouping stub. Returns null until a real scorer exists;
 * callers fall through to creating a new conversation.
 */
export async function chooseConversationByAi(_options: {
  tenancyId: string,
  externalThreadId: string | null,
  replyToMessageId: string | null,
  participantContactIds: readonly string[],
}): Promise<{ conversationId: string, confidence: number } | null> {
  return null;
}

/**
 * Deterministic conversation assignment for a newly ingested message:
 * 1. replyToMessageId → that message's conversation
 * 2. else externalThreadId → most recent message in that thread's conversation
 * 3. else AI stub (currently always null)
 * 4. else signal that a new conversation should be created
 */
export async function chooseConversationForMessage(
  tx: PrismaTransaction,
  options: {
    tenancyId: string,
    replyToMessageId: string | null,
    externalThreadId: string | null,
    participantContactIds?: readonly string[],
  },
): Promise<ConversationChoice> {
  if (options.replyToMessageId != null) {
    const replyTo = await tx.commsMessage.findUnique({
      where: {
        tenancyId_id: {
          tenancyId: options.tenancyId,
          id: options.replyToMessageId,
        },
      },
      select: {
        conversationId: true,
        conversation: {
          select: {
            mergedIntoConversationId: true,
          },
        },
      },
    });
    if (replyTo == null) {
      throw new StatusError(StatusError.BadRequest, "reply_to_message_id does not exist");
    }
    const conversationId = replyTo.conversation.mergedIntoConversationId ?? replyTo.conversationId;
    return {
      conversationId,
      reason: "reply",
      confidence: 1,
      created: false,
    };
  }

  if (options.externalThreadId != null && options.externalThreadId !== "") {
    const threadMessage = await tx.commsMessage.findFirst({
      where: {
        tenancyId: options.tenancyId,
        externalThreadId: options.externalThreadId,
        conversation: {
          mergedIntoConversationId: null,
        },
      },
      orderBy: [
        { occurredAt: "desc" },
        { id: "desc" },
      ],
      select: {
        conversationId: true,
      },
    });
    if (threadMessage != null) {
      return {
        conversationId: threadMessage.conversationId,
        reason: "external-thread",
        confidence: 1,
        created: false,
      };
    }
  }

  const aiChoice = await chooseConversationByAi({
    tenancyId: options.tenancyId,
    externalThreadId: options.externalThreadId,
    replyToMessageId: options.replyToMessageId,
    participantContactIds: options.participantContactIds ?? [],
  });
  if (aiChoice != null) {
    return {
      conversationId: aiChoice.conversationId,
      reason: "ai",
      confidence: aiChoice.confidence,
      created: false,
    };
  }

  return {
    conversationId: null,
    reason: null,
    confidence: null,
    created: true,
  };
}
