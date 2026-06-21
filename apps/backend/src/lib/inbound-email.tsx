import { appendConversationMessage, createConversation } from "@/lib/conversations";
import { globalPrismaClient } from "@/prisma-client";
import { getTenancy } from "@/lib/tenancies";
import { Prisma } from "@/generated/prisma/client";

/**
 * Inbound email → Conversations.
 *
 * Resend delivers received emails to a webhook. We resolve the recipient
 * (`support@<managed-subdomain>`) to a tenancy via the ManagedEmailDomain table,
 * confirm that the tenancy has configured a `role: "support"` address matching
 * the recipient, then create (or, for replies, append to) a conversation with
 * `source: "email"`.
 *
 * Threading: outbound support replies stamp an `X-Hexclave-Conversation-Id`
 * header (see sendConversationEmailReply). When a customer replies, that header
 * comes back and we append to the same conversation instead of opening a new one.
 */

export const INBOUND_CONVERSATION_HEADER = "x-hexclave-conversation-id";
export const SUPPORT_EMAIL_ADAPTER_KEY = "support-email";

export type ParsedInboundEmail = {
  fromEmail: string,
  fromName: string | null,
  recipients: string[],
  subject: string,
  body: string,
  conversationIdHeader: string | null,
};

export type ProcessInboundEmailResult =
  | { status: "created", tenancyId: string, conversationId: string }
  | { status: "appended", tenancyId: string, conversationId: string }
  | { status: "ignored", reason: string };

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Parse a "Name <email@example.com>" or bare "email@example.com" address. */
function parseAddress(raw: string): { email: string, name: string | null } {
  const trimmed = raw.trim();
  const open = trimmed.lastIndexOf("<");
  const close = trimmed.lastIndexOf(">");
  if (open !== -1 && close > open) {
    const email = trimmed.slice(open + 1, close).trim();
    const name = trimmed.slice(0, open).replace(/^"|"$/g, "").trim();
    return { email, name: name.length > 0 ? name : null };
  }
  return { email: trimmed, name: null };
}

/** Resend's `headers` may be an array of {name,value} or a plain object — read either. */
function extractHeaderValue(headers: unknown, name: string): string | null {
  const target = name.toLowerCase();
  if (Array.isArray(headers)) {
    for (const entry of headers) {
      if (
        entry != null && typeof entry === "object"
        && typeof (entry as { name?: unknown }).name === "string"
        && ((entry as { name: string }).name).toLowerCase() === target
        && typeof (entry as { value?: unknown }).value === "string"
      ) {
        return (entry as { value: string }).value;
      }
    }
    return null;
  }
  if (headers != null && typeof headers === "object") {
    for (const [key, value] of Object.entries(headers as Record<string, unknown>)) {
      if (key.toLowerCase() === target && typeof value === "string") {
        return value;
      }
    }
  }
  return null;
}

/** Minimal HTML→text fallback used only when an inbound email has no text part. */
function stripHtml(html: string): string {
  return html
    .replace(/<\s*(script|style)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseInboundResendPayload(payload: unknown): ParsedInboundEmail | null {
  if (payload == null || typeof payload !== "object") {
    return null;
  }
  const data = (payload as { data?: unknown }).data;
  if (data == null || typeof data !== "object") {
    return null;
  }
  const d = data as Record<string, unknown>;

  const fromRaw = typeof d.from === "string" ? d.from : "";
  const { email: fromEmail, name: fromName } = parseAddress(fromRaw);
  if (!fromEmail) {
    return null;
  }

  const toValue = d.to;
  const recipients = (Array.isArray(toValue) ? toValue : typeof toValue === "string" ? [toValue] : [])
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => parseAddress(entry).email)
    .filter((email) => email.length > 0);

  const subject = typeof d.subject === "string" && d.subject.length > 0 ? d.subject : "(no subject)";

  const text = typeof d.text === "string" ? d.text : "";
  const html = typeof d.html === "string" ? d.html : "";
  const body = text.trim().length > 0 ? text : (html.length > 0 ? stripHtml(html) : "");

  const conversationIdHeader = extractHeaderValue(d.headers, INBOUND_CONVERSATION_HEADER);

  return { fromEmail, fromName, recipients, subject, body, conversationIdHeader };
}

async function conversationExists(tenancyId: string, conversationId: string): Promise<boolean> {
  if (!UUID_REGEX.test(conversationId)) {
    return false;
  }
  const rows = await globalPrismaClient.$queryRaw<{ exists: boolean }[]>(Prisma.sql`
    SELECT EXISTS (
      SELECT 1 FROM "Conversation"
      WHERE "tenancyId" = ${tenancyId}::uuid AND "id" = ${conversationId}::uuid
    ) AS "exists"
  `);
  return rows[0]?.exists === true;
}

export async function processInboundEmail(parsed: ParsedInboundEmail): Promise<ProcessInboundEmailResult> {
  for (const recipient of parsed.recipients) {
    const atIndex = recipient.lastIndexOf("@");
    if (atIndex < 0) {
      continue;
    }
    const domain = recipient.slice(atIndex + 1).toLowerCase();

    const managedDomain = await globalPrismaClient.managedEmailDomain.findFirst({
      where: { subdomain: domain, isActive: true },
      select: { tenancyId: true },
    });
    if (managedDomain == null) {
      continue;
    }

    const tenancy = await getTenancy(managedDomain.tenancyId);
    if (tenancy == null) {
      continue;
    }

    // Only route mail addressed to an explicitly-configured support address — this
    // prevents random local parts (noreply@, etc.) on the domain from spawning
    // conversations.
    const recipientLower = recipient.toLowerCase();
    const isSupportAddress = Object.values(tenancy.config.emails.addresses).some(
      (address) => address.role === "support" && address.email?.toLowerCase() === recipientLower,
    );
    if (!isSupportAddress) {
      continue;
    }

    // Best-effort: link the conversation to a known user with this email.
    const contactChannel = await globalPrismaClient.contactChannel.findFirst({
      where: { tenancyId: tenancy.id, type: "EMAIL", value: parsed.fromEmail },
      select: { projectUserId: true },
    });
    const userId = contactChannel?.projectUserId ?? null;

    const sender = {
      type: "user" as const,
      id: userId,
      displayName: parsed.fromName,
      primaryEmail: parsed.fromEmail,
    };

    if (parsed.conversationIdHeader != null && await conversationExists(tenancy.id, parsed.conversationIdHeader)) {
      await appendConversationMessage({
        tenancyId: tenancy.id,
        conversationId: parsed.conversationIdHeader,
        messageType: "message",
        body: parsed.body,
        sender,
        channelType: "email",
        adapterKey: SUPPORT_EMAIL_ADAPTER_KEY,
      });
      return { status: "appended", tenancyId: tenancy.id, conversationId: parsed.conversationIdHeader };
    }

    const { conversationId } = await createConversation({
      tenancyId: tenancy.id,
      userId,
      subject: parsed.subject,
      priority: "normal",
      source: "email",
      channelType: "email",
      adapterKey: SUPPORT_EMAIL_ADAPTER_KEY,
      body: parsed.body,
      sender,
    });
    return { status: "created", tenancyId: tenancy.id, conversationId };
  }

  return { status: "ignored", reason: "No matching support address for any recipient" };
}
