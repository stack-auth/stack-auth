"use client";

import { Link } from "@/components/link";
import { DesignAlert, DesignBadge, DesignButton, DesignCard, DesignEditableGrid, DesignSelectorDropdown } from "@/components/design-components";
import { Typography } from "@/components/ui";
import { COMMS_CONTACTS, COMMS_TOPICS, getCommsContact, useCommsMessages, type CommsContact } from "@/lib/comms-mock";
import { ArrowLeftIcon, GitMergeIcon, IdentificationCardIcon, LinkSimpleIcon, NotePencilIcon } from "@phosphor-icons/react";
import { usePathname } from "next/navigation";
import { useMemo, useState } from "react";
import { AppEnabledGuard } from "../../app-enabled-guard";
import { PageLayout } from "../../page-layout";
import { useProjectId } from "../../use-admin-app";
import { ContactAvatar, InfoRow, MessageRow } from "../../comms/comms-components";

export default function PageClient() {
  const projectId = useProjectId();
  const contactId = useContactIdFromPathname();
  const contact = getCommsContact(contactId);
  const messages = useCommsMessages();
  const [mergeTargetId, setMergeTargetId] = useState(COMMS_CONTACTS.find((item) => item.id !== contactId)?.id ?? "");
  const [notice, setNotice] = useState<string | null>(null);

  const contactMessages = useMemo(() => messages.filter((message) => message.contactId === contactId), [contactId, messages]);
  const relatedTopics = useMemo(() => COMMS_TOPICS.filter((topic) => topic.contactIds.includes(contactId)), [contactId]);

  if (contact == null) {
    return (
      <AppEnabledGuard appId="authentication">
        <PageLayout title="Contact not found">
          <DesignAlert variant="error" description="This mock contact does not exist." />
        </PageLayout>
      </AppEnabledGuard>
    );
  }

  const mergeTarget = getCommsContact(mergeTargetId);
  const mergedPreview = mergeTarget == null ? null : getMergedPreview(contact, mergeTarget);

  return (
    <AppEnabledGuard appId="authentication">
      <PageLayout
        title={contact.name}
        description={`${contact.role} at ${contact.company}`}
        fillWidth
        actions={
          <DesignButton asChild variant="outline" size="sm">
            <Link href={`/projects/${encodeURIComponent(projectId)}/contacts`}>
              <ArrowLeftIcon className="h-4 w-4" />
              Contacts
            </Link>
          </DesignButton>
        }
      >
        {notice != null ? <DesignAlert variant="success" description={notice} /> : null}

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
          <div className="space-y-4">
            <DesignCard glassmorphic contentClassName="p-5">
              <div className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
                <div className="flex min-w-0 items-start gap-4">
                  <ContactAvatar contact={contact} size="lg" />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Typography className="text-2xl font-semibold">{contact.name}</Typography>
                      <DesignBadge label={contact.lifecycle} color={contact.lifecycle === "At risk" ? "orange" : "blue"} size="sm" />
                      {contact.userId != null ? <DesignBadge label="User-linked" color="green" size="sm" /> : <DesignBadge label="Contact-only" color="blue" size="sm" />}
                    </div>
                    <Typography variant="secondary" className="mt-1 text-sm">
                      {contact.role} · {contact.company} · Owned by {contact.owner}
                    </Typography>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {contact.tags.map((tag) => <DesignBadge key={tag} label={tag} color="cyan" size="sm" />)}
                    </div>
                  </div>
                </div>
                <div className="rounded-2xl border border-border/60 bg-foreground/[0.03] p-4 text-center">
                  <Typography variant="secondary" className="text-xs font-semibold uppercase tracking-wider">Contact score</Typography>
                  <Typography className="mt-1 text-3xl font-semibold">{contact.score}</Typography>
                </div>
              </div>
            </DesignCard>

            <DesignCard title="CRM fields" subtitle="Editable CRM-style details for the contact primitive." icon={IdentificationCardIcon} gradient="default" glassmorphic>
              <DesignEditableGrid
                columns={2}
                items={[
                  { icon: <IdentificationCardIcon className="h-4 w-4" />, name: "Lifecycle", type: "text", value: contact.lifecycle, readOnly: true },
                  { icon: <IdentificationCardIcon className="h-4 w-4" />, name: "Owner", type: "text", value: contact.owner, readOnly: true },
                  { icon: <IdentificationCardIcon className="h-4 w-4" />, name: "Source", type: "text", value: contact.source, readOnly: true },
                  { icon: <IdentificationCardIcon className="h-4 w-4" />, name: "Linked user", type: "text", value: contact.userId ?? "No product user yet", readOnly: true },
                ]}
              />
            </DesignCard>

            <DesignCard title="Channel identities" subtitle="Contacts can carry many handles per platform. Merging contacts combines these fields." icon={LinkSimpleIcon} gradient="default" glassmorphic>
              <div className="grid gap-3 md:grid-cols-2">
                <ChannelSection title="Emails" values={contact.channels.emails} empty="No emails yet" />
                <ChannelSection title="Slack IDs" values={contact.channels.slackIds} empty="No Slack IDs yet" />
                <ChannelSection title="Discord IDs" values={contact.channels.discordIds} empty="No Discord IDs yet" />
                <ChannelSection title="Support IDs" values={contact.channels.supportIds} empty="No support IDs yet" />
                <ChannelSection title="Push tokens" values={contact.channels.pushTokens} empty="No push tokens yet" />
              </div>
            </DesignCard>

            <DesignCard title="Recent communication" subtitle="Messages tied to this contact across every platform." icon={NotePencilIcon} gradient="default" glassmorphic>
              <div className="space-y-3">
                {contactMessages.map((message) => (
                  <MessageRow key={message.id} message={message} selected={false} onSelect={() => setNotice(`Selected mock message ${message.id}.`)} />
                ))}
              </div>
            </DesignCard>
          </div>

          <div className="space-y-4">
            <DesignCard title="Merge contacts" subtitle="Mock manual identity resolution for duplicate CRM/channel records." icon={GitMergeIcon} gradient="default" glassmorphic>
              <div className="space-y-4">
                <DesignSelectorDropdown
                  value={mergeTargetId}
                  options={COMMS_CONTACTS.filter((item) => item.id !== contact.id).map((item) => ({ value: item.id, label: `${item.name} · ${item.company}` }))}
                  onValueChange={setMergeTargetId}
                  size="md"
                />
                {mergedPreview != null ? (
                  <div className="space-y-2 rounded-2xl border border-border/60 bg-foreground/[0.03] p-4">
                    <InfoRow label="Emails after merge" value={mergedPreview.emailCount.toString()} />
                    <InfoRow label="Slack IDs after merge" value={mergedPreview.slackCount.toString()} />
                    <InfoRow label="Discord IDs after merge" value={mergedPreview.discordCount.toString()} />
                    <InfoRow label="Support IDs after merge" value={mergedPreview.supportCount.toString()} />
                  </div>
                ) : null}
                <DesignButton
                  className="w-full"
                  onClick={() => {
                    if (mergeTarget == null) {
                      throw new Error("Expected merge target to exist before merging mock contacts.");
                    }
                    setNotice(`Mock merged ${mergeTarget.name} into ${contact.name}. Channel fields would be combined in the real app.`);
                  }}
                >
                  <GitMergeIcon className="h-4 w-4" />
                  Merge in mock
                </DesignButton>
              </div>
            </DesignCard>

            <DesignCard glassmorphic contentClassName="space-y-3 p-5">
              <Typography className="text-sm font-semibold">Related topics</Typography>
              {relatedTopics.map((topic) => (
                <div key={topic.id} className="rounded-2xl border border-border/60 bg-foreground/[0.03] p-3">
                  <Typography className="text-sm font-semibold">{topic.title}</Typography>
                  <Typography variant="secondary" className="mt-1 line-clamp-2 text-xs">{topic.summary}</Typography>
                  <div className="mt-2 flex gap-1.5">
                    <DesignBadge label={`${topic.confidence}% AI`} color="purple" size="sm" />
                    <DesignBadge label={topic.status} color="blue" size="sm" />
                  </div>
                </div>
              ))}
            </DesignCard>

            <DesignCard glassmorphic contentClassName="space-y-3 p-5">
              <Typography className="text-sm font-semibold">Notes</Typography>
              {contact.notes.map((note) => (
                <Typography key={note} variant="secondary" className="rounded-2xl border border-border/60 bg-foreground/[0.03] p-3 text-sm">
                  {note}
                </Typography>
              ))}
            </DesignCard>
          </div>
        </div>
      </PageLayout>
    </AppEnabledGuard>
  );
}

function useContactIdFromPathname(): string {
  const pathname = usePathname();
  const marker = "/contacts/";
  const index = pathname.indexOf(marker);
  if (index === -1) {
    throw new Error("Expected contact detail page pathname to include /contacts/.");
  }
  return decodeURIComponent(pathname.slice(index + marker.length).split("/")[0] ?? "");
}

function ChannelSection({ title, values, empty }: { title: string, values: readonly string[], empty: string }) {
  return (
    <div className="rounded-2xl border border-border/60 bg-foreground/[0.03] p-4">
      <Typography className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</Typography>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {values.length === 0 ? <DesignBadge label={empty} color="blue" size="sm" /> : values.map((value) => <DesignBadge key={value} label={value} color="blue" size="sm" />)}
      </div>
    </div>
  );
}

function getMergedPreview(primary: CommsContact, secondary: CommsContact) {
  return {
    emailCount: new Set([...primary.channels.emails, ...secondary.channels.emails]).size,
    slackCount: new Set([...primary.channels.slackIds, ...secondary.channels.slackIds]).size,
    discordCount: new Set([...primary.channels.discordIds, ...secondary.channels.discordIds]).size,
    supportCount: new Set([...primary.channels.supportIds, ...secondary.channels.supportIds]).size,
  };
}
