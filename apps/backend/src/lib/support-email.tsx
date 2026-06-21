import { getEmailConfig } from "@/lib/emails";
import { lowLevelSendEmailDirectWithoutRetries } from "@/lib/emails-low-level";
import { Tenancy } from "@/lib/tenancies";

/**
 * Outbound side of the email-support bridge: when an agent replies to an
 * email-sourced conversation in the dashboard, deliver that reply to the
 * customer as an email from the project's support address.
 *
 * The reply carries an `X-Hexclave-Conversation-Id` header so that when the
 * customer replies, the inbound webhook threads it back into the same
 * conversation instead of opening a new one (see inbound-email.tsx).
 */

const CONVERSATION_HEADER_NAME = "X-Hexclave-Conversation-Id";

export type SendConversationEmailReplyResult =
  | { status: "sent" }
  | { status: "skipped", reason: string }
  | { status: "error", message: string };

export async function sendConversationEmailReply(options: {
  tenancy: Tenancy,
  conversationId: string,
  toEmail: string,
  subject: string,
  body: string,
}): Promise<SendConversationEmailReplyResult> {
  const emailConfig = await getEmailConfig(options.tenancy);
  if (emailConfig.type === "shared") {
    // The shared development server can't send from a project support address.
    return { status: "skipped", reason: "shared-email-server" };
  }

  // Prefer sending from a configured support address; fall back to the project's
  // default sender so a reply still goes out even if no support address is set.
  const supportAddress = Object.values(options.tenancy.config.emails.addresses)
    .find((address) => address.role === "support" && address.email != null);
  const senderEmail = supportAddress?.email ?? emailConfig.senderEmail;
  const senderName = supportAddress?.displayName ?? emailConfig.senderName;

  const replySubject = /^re:/i.test(options.subject.trim()) ? options.subject : `Re: ${options.subject}`;

  const result = await lowLevelSendEmailDirectWithoutRetries({
    tenancyId: options.tenancy.id,
    emailConfig: { ...emailConfig, senderEmail, senderName },
    to: options.toEmail,
    subject: replySubject,
    text: options.body,
    headers: { [CONVERSATION_HEADER_NAME]: options.conversationId },
  });

  if (result.status === "error") {
    return { status: "error", message: result.error.message ?? "Unknown email error" };
  }
  return { status: "sent" };
}
