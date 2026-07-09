"use client";

import { Link } from "@/components/link";
import {
  DesignBadge,
  DesignButton,
  DesignCard,
  DesignInput,
  DesignMenu,
  DesignSelectorDropdown,
} from "@/components/design-components";
import { Avatar, AvatarFallback, AvatarImage, Textarea, Typography, cn } from "@/components/ui";
import {
  COMMS_CONTACTS,
  COMMS_PLATFORM_LABELS,
  COMMS_PLATFORM_OPTIONS,
  type CommsContact,
  type CommsDraft,
  type CommsMessage,
  type CommsPlatform,
  formatCommsTimestamp,
  getCommsContact,
  getCommsTopic,
} from "@/lib/comms-mock";
import {
  BellRingingIcon,
  ChatCircleDotsIcon,
  DiscordLogoIcon,
  EnvelopeSimpleIcon,
  GitMergeIcon,
  PaperPlaneTiltIcon,
  SlackLogoIcon,
  TicketIcon,
  UserCircleIcon,
} from "@phosphor-icons/react";
import { useMemo, useState } from "react";

type ComposerValue = {
  platform: CommsPlatform,
  contactId: string,
  recipients: string,
  channelLabel: string,
  subject: string,
  body: string,
  attachments: string,
};

const platformIconMap = new Map<CommsPlatform, typeof EnvelopeSimpleIcon>([
  ["email", EnvelopeSimpleIcon],
  ["slack", SlackLogoIcon],
  ["discord", DiscordLogoIcon],
  ["support", TicketIcon],
  ["push", BellRingingIcon],
]);

const platformColorMap = new Map<CommsPlatform, "blue" | "green" | "purple" | "orange" | "cyan">([
  ["email", "blue"],
  ["slack", "green"],
  ["discord", "purple"],
  ["support", "orange"],
  ["push", "cyan"],
]);

function getPlatformIcon(platform: CommsPlatform) {
  const Icon = platformIconMap.get(platform);
  if (!Icon) {
    throw new Error(`Missing platform icon for ${platform}`);
  }
  return Icon;
}

function getPlatformColor(platform: CommsPlatform) {
  const color = platformColorMap.get(platform);
  if (!color) {
    throw new Error(`Missing platform color for ${platform}`);
  }
  return color;
}

export function PlatformBadge({ platform }: { platform: CommsPlatform }) {
  const Icon = getPlatformIcon(platform);
  return (
    <DesignBadge label={COMMS_PLATFORM_LABELS[platform]} icon={Icon} color={getPlatformColor(platform)} size="sm" />
  );
}

export function ContactAvatar({ contact, size = "md" }: { contact: CommsContact, size?: "sm" | "md" | "lg" }) {
  const sizeClass = size === "lg" ? "h-16 w-16" : size === "sm" ? "h-8 w-8" : "h-10 w-10";
  return (
    <Avatar className={cn(sizeClass, "shrink-0")}>
      <AvatarImage src={contact.avatarUrl} alt={contact.name} />
      <AvatarFallback>{contact.name.slice(0, 2)}</AvatarFallback>
    </Avatar>
  );
}

export function ContactIdentityLine({ contact }: { contact: CommsContact }) {
  const primaryEmail = contact.channels.emails[0];
  const primaryDiscord = contact.channels.discordIds[0];
  const primarySlack = contact.channels.slackIds[0];
  const primary = primaryEmail ?? primarySlack ?? primaryDiscord ?? contact.source;
  return (
    <Typography variant="secondary" className="truncate text-xs">
      {contact.company} · {contact.role} · {primary}
    </Typography>
  );
}

export function ContactMiniCard({ contact, projectId }: { contact: CommsContact, projectId: string }) {
  return (
    <Link
      href={`/projects/${encodeURIComponent(projectId)}/contacts/${encodeURIComponent(contact.id)}`}
      className="block rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <DesignCard glassmorphic contentClassName="p-4">
        <div className="flex items-start gap-3">
          <ContactAvatar contact={contact} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <Typography className="truncate text-sm font-semibold">{contact.name}</Typography>
              <DesignBadge label={contact.lifecycle} color={contact.lifecycle === "At risk" ? "orange" : "blue"} size="sm" />
            </div>
            <ContactIdentityLine contact={contact} />
            <div className="mt-3 flex flex-wrap gap-1.5">
              {contact.tags.slice(0, 3).map((tag) => (
                <DesignBadge key={tag} label={tag} color="cyan" size="sm" />
              ))}
            </div>
          </div>
        </div>
      </DesignCard>
    </Link>
  );
}

export function MessageRow({
  message,
  selected,
  onSelect,
}: {
  message: CommsMessage,
  selected: boolean,
  onSelect: () => void,
}) {
  const contact = getCommsContact(message.contactId);
  const topic = getCommsTopic(message.topicId);
  if (contact == null || topic == null) {
    throw new Error(`Mock message ${message.id} references a missing contact or topic.`);
  }
  const Icon = getPlatformIcon(message.platform);
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "w-full rounded-2xl p-4 text-left transition-colors duration-150 hover:transition-none",
        "border border-border/60 bg-background/70 hover:bg-foreground/[0.04]",
        selected && "border-blue-500/40 bg-blue-500/[0.06]"
      )}
    >
      <div className="flex items-start gap-3">
        <div className="relative">
          <ContactAvatar contact={contact} size="sm" />
          <div className="absolute -bottom-1 -right-1 rounded-full bg-background p-0.5 ring-1 ring-border">
            <Icon className="h-3.5 w-3.5 text-muted-foreground" />
          </div>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3">
            <Typography className="truncate text-sm font-semibold">{contact.name}</Typography>
            <Typography variant="secondary" className="shrink-0 text-[11px]">
              {formatCommsTimestamp(message.timestamp)}
            </Typography>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <PlatformBadge platform={message.platform} />
            <DesignBadge label={message.direction === "inbound" ? "Inbound" : "Sent"} color={message.direction === "inbound" ? "green" : "blue"} size="sm" />
            {message.urgency === "high" ? <DesignBadge label="High urgency" color="orange" size="sm" /> : null}
          </div>
          <Typography className="mt-2 truncate text-sm font-medium">
            {message.subject ?? topic.title}
          </Typography>
          <Typography variant="secondary" className="mt-1 line-clamp-2 text-xs">
            {message.text}
          </Typography>
        </div>
      </div>
    </button>
  );
}

export function MessageDetailPanel({ message, projectId }: { message: CommsMessage, projectId: string }) {
  const contact = getCommsContact(message.contactId);
  const topic = getCommsTopic(message.topicId);
  if (contact == null || topic == null) {
    throw new Error(`Mock message ${message.id} references a missing contact or topic.`);
  }
  return (
    <DesignCard glassmorphic contentClassName="p-0 overflow-hidden">
      <div className="border-b border-border/60 p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <PlatformBadge platform={message.platform} />
              <DesignBadge label={message.status} color={message.status === "new" ? "green" : "blue"} size="sm" />
            </div>
            <Typography className="text-lg font-semibold">
              {message.subject ?? topic.title}
            </Typography>
            <Typography variant="secondary" className="mt-1 text-sm">
              {message.direction === "inbound" ? "Received" : "Sent"} via {message.channelLabel} · {formatCommsTimestamp(message.timestamp)}
            </Typography>
          </div>
          <DesignMenu
            variant="actions"
            trigger="button"
            triggerLabel="Actions"
            align="end"
            items={[
              { id: "assign", label: "Assign to me" },
              { id: "topic", label: "Move to another topic" },
              { id: "split", label: "Split into new topic" },
            ]}
          />
        </div>
      </div>
      <div className="grid gap-0 lg:grid-cols-[1fr_280px]">
        <div className="space-y-5 p-5">
          {message.platform === "email" && message.htmlBody != null ? (
            <div className="rounded-2xl border border-border/60 bg-foreground/[0.02] p-4">
              <Typography className="text-sm leading-6">{message.text}</Typography>
            </div>
          ) : (
            <div className="rounded-2xl border border-border/60 bg-foreground/[0.02] p-4">
              <Typography className="whitespace-pre-wrap text-sm leading-6">{message.text}</Typography>
            </div>
          )}
          {message.attachments.length > 0 ? (
            <div className="space-y-2">
              <Typography className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Attachments</Typography>
              <div className="flex flex-wrap gap-2">
                {message.attachments.map((attachment) => (
                  <DesignBadge key={attachment} label={attachment} color="cyan" size="sm" />
                ))}
              </div>
            </div>
          ) : null}
          <DesignCard glassmorphic contentClassName="p-4">
            <div className="flex items-start gap-3">
              <ChatCircleDotsIcon className="mt-0.5 h-4 w-4 text-blue-500" />
              <div>
                <Typography className="text-sm font-semibold">AI topic assignment</Typography>
                <Typography variant="secondary" className="mt-1 text-sm">{message.aiReason}</Typography>
              </div>
            </div>
          </DesignCard>
        </div>
        <div className="border-t border-border/60 p-5 lg:border-l lg:border-t-0">
          <div className="flex items-start gap-3">
            <ContactAvatar contact={contact} />
            <div className="min-w-0">
              <Link
                href={`/projects/${encodeURIComponent(projectId)}/contacts/${encodeURIComponent(contact.id)}`}
                className="text-sm font-semibold text-foreground hover:underline"
              >
                {contact.name}
              </Link>
              <ContactIdentityLine contact={contact} />
            </div>
          </div>
          <div className="mt-5 space-y-3 text-sm">
            <InfoRow label="Topic" value={topic.title} />
            <InfoRow label="Owner" value={topic.owner} />
            <InfoRow label="Lifecycle" value={contact.lifecycle} />
            <InfoRow label="Contact score" value={`${contact.score}/100`} />
          </div>
          <DesignButton className="mt-5 w-full" size="sm">
            Reply in topic
          </DesignButton>
        </div>
      </div>
    </DesignCard>
  );
}

export function InfoRow({ label, value }: { label: string, value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <Typography variant="secondary" className="text-xs">{label}</Typography>
      <Typography className="min-w-0 truncate text-right text-xs font-medium">{value}</Typography>
    </div>
  );
}

export function MessageBubble({ message }: { message: CommsMessage }) {
  const contact = getCommsContact(message.contactId);
  if (contact == null) {
    throw new Error(`Mock message ${message.id} references missing contact ${message.contactId}.`);
  }
  const Icon = getPlatformIcon(message.platform);
  const isOutbound = message.direction === "outbound";
  return (
    <div className={cn("flex gap-3", isOutbound && "flex-row-reverse")}>
      <div className="relative">
        <ContactAvatar contact={contact} size="sm" />
        <div className="absolute -bottom-1 -right-1 rounded-full bg-background p-0.5 ring-1 ring-border">
          <Icon className="h-3.5 w-3.5 text-muted-foreground" />
        </div>
      </div>
      <div className={cn("max-w-[78%] rounded-2xl border p-3", isOutbound ? "border-blue-500/30 bg-blue-500/[0.08]" : "border-border/60 bg-foreground/[0.03]")}>
        <div className="mb-1 flex items-center gap-2">
          <Typography className="text-xs font-semibold">{isOutbound ? "Your team" : contact.name}</Typography>
          <Typography variant="secondary" className="text-[11px]">{COMMS_PLATFORM_LABELS[message.platform]}</Typography>
        </div>
        {message.subject != null ? <Typography className="mb-1 text-xs font-semibold">{message.subject}</Typography> : null}
        <Typography className="whitespace-pre-wrap text-sm leading-6">{message.text}</Typography>
      </div>
    </div>
  );
}

export function CommsComposer({
  initialPlatform = "email",
  initialContactId = COMMS_CONTACTS[0]?.id ?? "",
  submitLabel = "Save draft",
  compact = false,
  onSubmit,
}: {
  initialPlatform?: CommsPlatform,
  initialContactId?: string,
  submitLabel?: string,
  compact?: boolean,
  onSubmit: (value: ComposerValue) => void,
}) {
  const [platform, setPlatform] = useState<CommsPlatform>(initialPlatform);
  const [contactId, setContactId] = useState(initialContactId);
  const contact = getCommsContact(contactId) ?? COMMS_CONTACTS[0];
  if (contact == null) {
    throw new Error("Expected at least one mock Comms contact.");
  }
  const defaultRecipient = contact.channels.emails[0] ?? contact.channels.discordIds[0] ?? contact.channels.slackIds[0] ?? "";
  const [recipients, setRecipients] = useState(defaultRecipient);
  const [channelLabel, setChannelLabel] = useState(getDefaultChannelLabel(platform, contact));
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [attachments, setAttachments] = useState("");

  const platformHelp = getComposerHelp(platform);
  const selectedContactOptions = useMemo(() => COMMS_CONTACTS.map((item) => ({ value: item.id, label: `${item.name} · ${item.company}` })), []);

  return (
    <DesignCard glassmorphic contentClassName={cn("space-y-4", compact ? "p-4" : "p-5")}>
      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-1.5">
          <Typography className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Platform</Typography>
          <DesignSelectorDropdown
            value={platform}
            options={COMMS_PLATFORM_OPTIONS}
            onValueChange={(value) => {
              const nextPlatform = parsePlatform(value);
              setPlatform(nextPlatform);
              setChannelLabel(getDefaultChannelLabel(nextPlatform, contact));
            }}
            size="md"
          />
        </div>
        <div className="space-y-1.5">
          <Typography className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Contact</Typography>
          <DesignSelectorDropdown
            value={contactId}
            options={selectedContactOptions}
            onValueChange={(value) => {
              const nextContact = getCommsContact(value);
              if (nextContact == null) {
                throw new Error(`Unknown mock contact ${value}`);
              }
              setContactId(nextContact.id);
              setRecipients(nextContact.channels.emails[0] ?? nextContact.channels.discordIds[0] ?? nextContact.channels.slackIds[0] ?? "");
              setChannelLabel(getDefaultChannelLabel(platform, nextContact));
            }}
            size="md"
          />
        </div>
      </div>

      <Typography variant="secondary" className="text-sm">{platformHelp}</Typography>

      {platform === "email" ? (
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Recipients">
            <DesignInput value={recipients} onChange={(event) => setRecipients(event.target.value)} placeholder="customer@example.com" />
          </Field>
          <Field label="Subject">
            <DesignInput value={subject} onChange={(event) => setSubject(event.target.value)} placeholder="Subject" />
          </Field>
        </div>
      ) : null}

      {platform === "discord" || platform === "slack" || platform === "support" ? (
        <div className="grid gap-3 md:grid-cols-2">
          <Field label={platform === "support" ? "Ticket" : "Channel / thread"}>
            <DesignInput value={channelLabel} onChange={(event) => setChannelLabel(event.target.value)} placeholder="Choose destination" />
          </Field>
          <Field label="Reply context">
            <DesignInput value={recipients} onChange={(event) => setRecipients(event.target.value)} placeholder="Contact handle or message id" />
          </Field>
        </div>
      ) : null}

      {platform === "push" ? (
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Push audience">
            <DesignInput value={channelLabel} onChange={(event) => setChannelLabel(event.target.value)} placeholder="Production Android cohort" />
          </Field>
          <Field label="Title">
            <DesignInput value={subject} onChange={(event) => setSubject(event.target.value)} placeholder="Notification title" />
          </Field>
        </div>
      ) : null}

      <Field label={platform === "email" ? "HTML email body" : "Message"}>
        <Textarea
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder={platform === "email" ? "<p>Write the email body...</p>" : "Write the message..."}
          className="min-h-32 rounded-xl"
        />
      </Field>

      <Field label="Attachments">
        <DesignInput value={attachments} onChange={(event) => setAttachments(event.target.value)} placeholder="proposal.pdf, screenshot.png" />
      </Field>

      <div className="flex justify-end gap-2">
        <DesignButton
          variant="outline"
          onClick={() => {
            setSubject("");
            setBody("");
            setAttachments("");
          }}
        >
          Clear
        </DesignButton>
        <DesignButton
          onClick={() => onSubmit({ platform, contactId, recipients, channelLabel, subject, body, attachments })}
          disabled={body.trim() === ""}
        >
          <PaperPlaneTiltIcon className="h-4 w-4" />
          {submitLabel}
        </DesignButton>
      </div>
    </DesignCard>
  );
}

export function DraftCard({ draft }: { draft: CommsDraft }) {
  const contact = getCommsContact(draft.contactId);
  if (contact == null) {
    throw new Error(`Mock draft ${draft.id} references missing contact ${draft.contactId}.`);
  }
  return (
    <DesignCard glassmorphic contentClassName="p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <PlatformBadge platform={draft.platform} />
            <DesignBadge label={draft.status} color={draft.status === "scheduled" ? "purple" : "blue"} size="sm" />
          </div>
          <Typography className="truncate text-sm font-semibold">{draft.title}</Typography>
          <Typography variant="secondary" className="mt-1 truncate text-xs">
            {contact.name} · {draft.channelLabel} · Updated {formatCommsTimestamp(draft.updatedAt)}
          </Typography>
          <Typography variant="secondary" className="mt-3 line-clamp-2 text-sm">{draft.body}</Typography>
        </div>
        <DesignMenu
          variant="actions"
          trigger="icon"
          triggerLabel="Draft actions"
          align="end"
          items={[
            { id: "edit", label: "Edit draft" },
            { id: "duplicate", label: "Duplicate" },
            { id: "delete", label: "Delete", itemVariant: "destructive" },
          ]}
        />
      </div>
    </DesignCard>
  );
}

export function MergeOverrideMenu({ label, onMerge, onSplit }: { label: string, onMerge: () => void, onSplit: () => void }) {
  return (
    <DesignMenu
      variant="actions"
      trigger="button"
      triggerLabel={label}
      align="end"
      withIcons
      items={[
        { id: "merge", label: "Merge selected records", icon: <GitMergeIcon className="h-4 w-4" />, onClick: onMerge },
        { id: "split", label: "Split into new record", icon: <UserCircleIcon className="h-4 w-4" />, onClick: onSplit },
      ]}
    />
  );
}

function Field({ label, children }: { label: string, children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Typography className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</Typography>
      {children}
    </div>
  );
}

function parsePlatform(value: string): CommsPlatform {
  if (value === "email" || value === "slack" || value === "discord" || value === "support" || value === "push") {
    return value;
  }
  throw new Error(`Unknown Comms platform ${value}`);
}

function getDefaultChannelLabel(platform: CommsPlatform, contact: CommsContact): string {
  if (platform === "email") return contact.channels.emails[0] ?? "";
  if (platform === "slack") return contact.channels.slackIds[0] != null ? `Shared Slack / ${contact.channels.slackIds[0]}` : "Shared Slack / #general";
  if (platform === "discord") return contact.channels.discordIds[0] != null ? `Discord / ${contact.channels.discordIds[0]}` : "Discord / #general";
  if (platform === "support") return contact.channels.supportIds[0] ?? "support:new-ticket";
  return contact.channels.pushTokens[0] ?? "All opted-in devices";
}

function getComposerHelp(platform: CommsPlatform): string {
  if (platform === "email") {
    return "Email supports recipients, a subject, attachments, and a richer body. This mock keeps the editor lightweight for the presentation.";
  }
  if (platform === "discord") {
    return "Discord replies require a server/channel/thread or an incoming Discord message to anchor the response.";
  }
  if (platform === "slack") {
    return "Shared Slack replies can target channels, threads, or unthreaded account rooms.";
  }
  if (platform === "support") {
    return "Support ticket replies stay attached to the external ticket id and can include ticket-safe attachments.";
  }
  return "Push is send-only, so the composer asks for an audience and notification title instead of a reply target.";
}
